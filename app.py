import os
import time
import numpy as np
import pandas as pd
from flask import Flask, jsonify, render_template, request
import yfinance as yf
from sklearn.preprocessing import StandardScaler
from sklearn.decomposition import PCA
from sklearn.cluster import KMeans, AgglomerativeClustering
from sklearn.metrics import silhouette_score, davies_bouldin_score
import scipy.cluster.hierarchy as sch

app = Flask(__name__)

# Global Cache to prevent hitting Yahoo Finance API repeatedly
_DATA_CACHE = None
_CACHE_TIMESTAMP = 0
CACHE_EXPIRY = 3600 * 4  # Cache results for 4 hours

# Tickers config
BENCHMARK_TICKER = "^NSEI"
STOCK_TICKERS = [
    "RELIANCE.NS",
    "TCS.NS",
    "HDFCBANK.NS",
    "INFY.NS",
    "ICICIBANK.NS",
    "WIPRO.NS",
    "BAJFINANCE.NS",
    "MARUTI.NS"
]

SHORT_NAMES = {
    "RELIANCE.NS": "Reliance",
    "TCS.NS": "TCS",
    "HDFCBANK.NS": "HDFC Bank",
    "INFY.NS": "Infosys",
    "ICICIBANK.NS": "ICICI Bank",
    "WIPRO.NS": "Wipro",
    "BAJFINANCE.NS": "Bajaj Fin",
    "MARUTI.NS": "Maruti"
}

def compute_rsi(prices, window=14):
    """
    Wilder's RSI calculation using exponential moving averages.
    """
    delta = prices.diff()
    gain = delta.copy()
    loss = delta.copy()
    gain[gain < 0] = 0
    loss[loss > 0] = 0
    loss = abs(loss)
    
    # Wilder's smoothing
    avg_gain = gain.ewm(alpha=1/window, min_periods=window).mean()
    avg_loss = loss.ewm(alpha=1/window, min_periods=window).mean()
    
    rs = avg_gain / avg_loss
    rsi = 100 - (100 / (1 + rs))
    return rsi

def generate_multi_stock_regime_data():
    global _DATA_CACHE, _CACHE_TIMESTAMP
    
    # Check if cache is still valid
    if _DATA_CACHE is not None and (time.time() - _CACHE_TIMESTAMP) < CACHE_EXPIRY:
        return _DATA_CACHE

    print("[*] Downloading index and stock prices from Yahoo Finance...")
    
    data_dfs = {}
    
    # 1. Download Benchmark
    try:
        df_bench = yf.download(BENCHMARK_TICKER, start="2010-01-01", end="2024-12-31")
        if not df_bench.empty:
            df_bench = df_bench.reset_index()
            if isinstance(df_bench.columns, pd.MultiIndex):
                df_bench.columns = [col[0] for col in df_bench.columns]
            df_bench['Date'] = pd.to_datetime(df_bench['Date'])
            df_bench['Close'] = df_bench['Close'].astype(float)
            data_dfs[BENCHMARK_TICKER] = df_bench[['Date', 'Close']].copy()
            print(f"    - Loaded benchmark {BENCHMARK_TICKER} with {len(df_bench)} rows.")
    except Exception as e:
        print(f"[!] Error downloading benchmark {BENCHMARK_TICKER}: {e}")
        
    # 2. Download 8 Stocks with graceful skipping
    loaded_stocks = []
    for ticker in STOCK_TICKERS:
        try:
            df_stock = yf.download(ticker, start="2010-01-01", end="2024-12-31")
            if not df_stock.empty:
                df_stock = df_stock.reset_index()
                if isinstance(df_stock.columns, pd.MultiIndex):
                    df_stock.columns = [col[0] for col in df_stock.columns]
                df_stock['Date'] = pd.to_datetime(df_stock['Date'])
                df_stock['Close'] = df_stock['Close'].astype(float)
                data_dfs[ticker] = df_stock[['Date', 'Close']].copy()
                loaded_stocks.append(ticker)
                print(f"    - Loaded stock {ticker} with {len(df_stock)} rows.")
            else:
                print(f"[!] Warning: {ticker} returned empty dataset. Skipping.")
        except Exception as e:
            print(f"[!] Error downloading stock {ticker}: {e}. Skipping.")

    if BENCHMARK_TICKER not in data_dfs:
        raise ValueError("Critical: Failed to download Nifty 50 benchmark data.")
    if len(loaded_stocks) == 0:
        raise ValueError("Critical: Failed to download any of the 8 Indian stocks.")

    # 3. Align all dataframes by doing an inner join on Date
    merged_df = data_dfs[BENCHMARK_TICKER].rename(columns={'Close': 'Nifty50'})
    for ticker in loaded_stocks:
        temp_df = data_dfs[ticker][['Date', 'Close']].rename(columns={'Close': ticker})
        merged_df = pd.merge(merged_df, temp_df, on='Date', how='inner')
        
    merged_df = merged_df.sort_values('Date').reset_index(drop=True)
    print(f"[*] Aligned dataset contains {len(merged_df)} daily observations.")

    # 4. Feature Engineering per Stock & Composite Averaging
    stock_features = {}
    for ticker in loaded_stocks:
        prices = merged_df[ticker]
        
        # Calculate daily log return
        log_ret = np.log(prices / prices.shift(1))
        # 21-day rolling annualized volatility
        vol_21 = log_ret.rolling(window=21).std() * np.sqrt(252)
        # 21-day rolling annualized mean return
        mean_ret_21 = log_ret.rolling(window=21).mean() * 252
        # 63-day momentum (log return)
        mom_63 = np.log(prices / prices.shift(63))
        # RSI-14
        rsi_14 = compute_rsi(prices, window=14)
        # 50d/200d Moving Average Ratio
        ma_50 = prices.rolling(window=50).mean()
        ma_200 = prices.rolling(window=200).mean()
        ma_50_200 = ma_50 / ma_200
        
        stock_features[ticker] = {
            'log_ret': log_ret,
            'vol_21': vol_21,
            'mean_ret_21': mean_ret_21,
            'mom_63': mom_63,
            'rsi_14': rsi_14,
            'ma_50_200': ma_50_200
        }

    # Average features across all successfully loaded stocks to form composite feature columns
    feature_cols = ['log_ret', 'vol_21', 'mean_ret_21', 'mom_63', 'rsi_14', 'ma_50_200']
    for feat in feature_cols:
        series_list = [stock_features[ticker][feat] for ticker in loaded_stocks]
        merged_df[feat] = pd.concat(series_list, axis=1).mean(axis=1)

    # 5. Handle Correlation Matrix (8x8 return correlation)
    returns_df = merged_df[loaded_stocks].pct_change().dropna()
    corr_matrix_raw = returns_df.corr().values  # 8x8 numpy array
    short_labels = [SHORT_NAMES[t] for t in loaded_stocks]
    
    correlation_data = {
        'matrix': corr_matrix_raw.tolist(),
        'labels': short_labels
    }

    # Drop rows containing NaNs from feature calculation lookbacks
    df_clean = merged_df.dropna().reset_index(drop=True)
    
    # 6. Scaling & Modeling
    X = df_clean[feature_cols].values
    scaler = StandardScaler()
    X_scaled = scaler.fit_transform(X)
    
    # PCA
    pca_full = PCA()
    pca_full.fit(X_scaled)
    pca_var = pca_full.explained_variance_ratio_.tolist()
    
    pca_2 = PCA(n_components=2)
    X_pca_2 = pca_2.fit_transform(X_scaled)
    df_clean['PC1'] = X_pca_2[:, 0]
    df_clean['PC2'] = X_pca_2[:, 1]
    
    # K-Means optimization (K=2 to 8)
    elbow_data = []
    for k in range(2, 9):
        km = KMeans(n_clusters=k, random_state=42, n_init=10)
        km_labels = km.fit_predict(X_scaled)
        inertia = float(km.inertia_)
        sil = float(silhouette_score(X_scaled, km_labels))
        elbow_data.append({
            'k': k,
            'inertia': inertia,
            'silhouette': sil
        })
        
    # Forced K-Means (K=3) & Dynamic Labeling (ranked by composite mean_ret_21)
    kmeans_3 = KMeans(n_clusters=3, random_state=42, n_init=10)
    kmeans_3.fit(X_scaled)
    labels_3 = kmeans_3.labels_
    
    # Profile cluster returns
    cluster_returns = []
    for c in range(3):
        mask = (labels_3 == c)
        avg_ret = df_clean.loc[mask, 'mean_ret_21'].mean()
        cluster_returns.append((c, avg_ret))
    
    # Sort cluster indices ascending
    sorted_clusters = sorted(cluster_returns, key=lambda x: x[1])
    label_map = {
        sorted_clusters[0][0]: 0,  # Lowest return = Bear
        sorted_clusters[1][0]: 1,  # Middle return = Sideways
        sorted_clusters[2][0]: 2   # Highest return = Bull
    }
    df_clean['Regime'] = [label_map[l] for l in labels_3]
    
    # 7. Metrics
    final_regimes = df_clean['Regime'].values
    silhouette = float(silhouette_score(X_scaled, final_regimes))
    db_index = float(davies_bouldin_score(X_scaled, final_regimes))
    pc1_pct = float(pca_var[0] * 100)
    pc2_pct = float(pca_var[1] * 100)
    pc_cum_pct = pc1_pct + pc2_pct
    total_days = len(df_clean)
    
    metrics = {
        'silhouette': silhouette,
        'db_index': db_index,
        'pc1_pct': pc1_pct,
        'pc_cum_pct': pc_cum_pct,
        'total_days': int(total_days)
    }

    # 8. Ward Hierarchical Clustering on Monthly Resampled Composite Data
    df_monthly = df_clean.set_index('Date').resample('ME').mean().reset_index()
    X_monthly = df_monthly[feature_cols].values
    X_monthly_scaled = StandardScaler().fit_transform(X_monthly)
    
    # Ward Linkage
    linkage_matrix = sch.linkage(X_monthly_scaled, method='ward')
    
    # 9. Format API Payload Outputs
    # Every 5th row for Nifty 50 Timeline
    df_5th = df_clean.iloc[::5]
    price_data = []
    for _, row in df_5th.iterrows():
        price_data.append({
            'date': row['Date'].strftime('%Y-%m-%d'),
            'price': float(row['Nifty50']),
            'regime': int(row['Regime']),
            'volatility': float(row['vol_21']),
            'rsi': float(row['rsi_14'])
        })
        
    # Stock Close prices every 5th row for stock comparison line chart
    stock_data = {}
    for ticker in loaded_stocks:
        stock_data[ticker] = df_5th[ticker].astype(float).round(2).tolist()
        
    # PCA scatter 800 sample
    df_pca_sample = df_clean.sample(n=min(800, len(df_clean)), random_state=42).sort_index()
    pca_data = []
    for _, row in df_pca_sample.iterrows():
        pca_data.append({
            'pc1': float(row['PC1']),
            'pc2': float(row['PC2']),
            'regime': int(row['Regime'])
        })
        
    # Pie chart percentage shares
    regime_counts = df_clean['Regime'].value_counts()
    pie_data = {
        'bear': float((regime_counts.get(0, 0) / total_days) * 100),
        'sideways': float((regime_counts.get(1, 0) / total_days) * 100),
        'bull': float((regime_counts.get(2, 0) / total_days) * 100)
    }
    
    # Stats table profiles
    summary_data = []
    names = {0: "Bear", 1: "Sideways", 2: "Bull"}
    for r in [0, 1, 2]:
        mask = (df_clean['Regime'] == r)
        df_r = df_clean[mask]
        
        count = len(df_r)
        pct = (count / total_days) * 100
        
        avg_ret = df_r['mean_ret_21'].mean() * 100
        avg_vol = df_r['vol_21'].mean() * 100
        avg_rsi = df_r['rsi_14'].mean()
        
        summary_data.append({
            'regime': r,
            'name': names[r],
            'days': int(count),
            'pct': float(pct),
            'avg_ret': float(avg_ret),
            'avg_vol': float(avg_vol),
            'avg_rsi': float(avg_rsi)
        })
        
    # Compile the final data package
    _DATA_CACHE = {
        'price_data': price_data,
        'stock_data': stock_data,
        'pca_data': pca_data,
        'pie_data': pie_data,
        'summary_data': summary_data,
        'elbow_data': elbow_data,
        'pca_var': pca_var,
        'correlation_matrix': correlation_data,
        'metrics': metrics,
        'total_days': total_days
    }
    _CACHE_TIMESTAMP = time.time()
    
    return _DATA_CACHE

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/api/data')
def get_data():
    try:
        force_reload = request.args.get('reload', 'false').lower() == 'true'
        global _DATA_CACHE
        if force_reload:
            _DATA_CACHE = None
            
        data = generate_multi_stock_regime_data()
        return jsonify(data)
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500

if __name__ == '__main__':
    # Flask runs locally on port 5000 by default
    app.run(debug=True, host='127.0.0.1', port=5000)

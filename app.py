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

# In-Memory Raw Data Cache (preserves downloads to support instant parameter sliders)
_RAW_PRICE_CACHE = {}
_CUSTOM_PRICE_CACHE = None

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

def load_raw_data_if_needed():
    global _RAW_PRICE_CACHE
    if _RAW_PRICE_CACHE:
        return
        
    print("[*] Pre-downloading raw benchmarks and stock series from Yahoo Finance...")
    # 1. Download Nifty 50
    try:
        df_bench = yf.download(BENCHMARK_TICKER, start="2010-01-01", end="2024-12-31")
        if not df_bench.empty:
            df_bench = df_bench.reset_index()
            if isinstance(df_bench.columns, pd.MultiIndex):
                df_bench.columns = [col[0] for col in df_bench.columns]
            df_bench['Date'] = pd.to_datetime(df_bench['Date'])
            df_bench['Close'] = df_bench['Close'].astype(float)
            _RAW_PRICE_CACHE[BENCHMARK_TICKER] = df_bench[['Date', 'Close']].copy()
            print(f"    - Preloaded benchmark {BENCHMARK_TICKER}")
    except Exception as e:
        print(f"[!] Error preloading benchmark {BENCHMARK_TICKER}: {e}")
        
    # 2. Download 8 Stocks
    for ticker in STOCK_TICKERS:
        try:
            df_stock = yf.download(ticker, start="2010-01-01", end="2024-12-31")
            if not df_stock.empty:
                df_stock = df_stock.reset_index()
                if isinstance(df_stock.columns, pd.MultiIndex):
                    df_stock.columns = [col[0] for col in df_stock.columns]
                df_stock['Date'] = pd.to_datetime(df_stock['Date'])
                df_stock['Close'] = df_stock['Close'].astype(float)
                _RAW_PRICE_CACHE[ticker] = df_stock[['Date', 'Close']].copy()
                print(f"    - Preloaded stock {ticker}")
        except Exception as e:
            print(f"[!] Error preloading stock {ticker}: {e}")

def run_regime_pipeline(k, vol_win, ret_win, mom_win, rsi_win, selected_stocks):
    global _RAW_PRICE_CACHE, _CUSTOM_PRICE_CACHE

    # 1. Check if we use custom uploaded data or default presets
    if _CUSTOM_PRICE_CACHE is not None:
        df_source = _CUSTOM_PRICE_CACHE['df'].copy()
        loaded_stocks = [s for s in selected_stocks if s in _CUSTOM_PRICE_CACHE['stock_tickers'] and s in df_source.columns]
        if not loaded_stocks:
            loaded_stocks = [s for s in _CUSTOM_PRICE_CACHE['stock_tickers'] if s in df_source.columns]
        short_names = _CUSTOM_PRICE_CACHE['short_names']
        benchmark_col = 'Nifty50'
    else:
        load_raw_data_if_needed()
        if BENCHMARK_TICKER not in _RAW_PRICE_CACHE:
            raise ValueError("Benchmark data not preloaded.")
            
        df_source = _RAW_PRICE_CACHE[BENCHMARK_TICKER].rename(columns={'Close': 'Nifty50'})
        loaded_stocks = [s for s in selected_stocks if s in _RAW_PRICE_CACHE]
        short_names = SHORT_NAMES
        
        # Merge selected stocks
        for ticker in loaded_stocks:
            temp_df = _RAW_PRICE_CACHE[ticker][['Date', 'Close']].rename(columns={'Close': ticker})
            df_source = pd.merge(df_source, temp_df, on='Date', how='inner')
            
        df_source = df_source.sort_values('Date').reset_index(drop=True)
        benchmark_col = 'Nifty50'

    if len(loaded_stocks) == 0:
        raise ValueError("No active stocks selected or available for feature averaging.")

    # 2. Compute stock-specific rolling indicators
    stock_features = {}
    for ticker in loaded_stocks:
        prices = df_source[ticker]
        
        log_ret = np.log(prices / prices.shift(1))
        vol_21 = log_ret.rolling(window=vol_win).std() * np.sqrt(252)
        mean_ret_21 = log_ret.rolling(window=ret_win).mean() * 252
        mom_63 = np.log(prices / prices.shift(mom_win))
        rsi_14 = compute_rsi(prices, window=rsi_win)
        
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

    # 3. Compile composite features by averaging across selected assets
    feature_cols = ['log_ret', 'vol_21', 'mean_ret_21', 'mom_63', 'rsi_14', 'ma_50_200']
    df_features = df_source[['Date', benchmark_col] + loaded_stocks].copy()
    
    for feat in feature_cols:
        series_list = [stock_features[ticker][feat] for ticker in loaded_stocks]
        df_features[feat] = pd.concat(series_list, axis=1).mean(axis=1)

    # 4. Pairwise stock returns correlation matrix
    returns_df = df_features[loaded_stocks].pct_change().dropna()
    if not returns_df.empty:
        corr_matrix = returns_df.corr().values
        short_labels = [short_names.get(t, t) for t in loaded_stocks]
    else:
        corr_matrix = np.ones((len(loaded_stocks), len(loaded_stocks)))
        short_labels = [short_names.get(t, t) for t in loaded_stocks]
        
    correlation_data = {
        'matrix': corr_matrix.tolist(),
        'labels': short_labels
    }

    # Drop NaNs
    df_clean = df_features.dropna().reset_index(drop=True)
    total_days = len(df_clean)
    
    if total_days < k + 10:
        raise ValueError(f"Aligned dataset size ({total_days} days) is too small for the selected lookback windows.")

    # 5. Standardization
    X = df_clean[feature_cols].values
    scaler = StandardScaler()
    X_scaled = scaler.fit_transform(X)

    # 6. PCA (Variance loaders & coordinates)
    pca_full = PCA()
    pca_full.fit(X_scaled)
    pca_var = pca_full.explained_variance_ratio_.tolist()
    
    pca_2 = PCA(n_components=2)
    X_pca_2 = pca_2.fit_transform(X_scaled)
    df_clean['PC1'] = X_pca_2[:, 0]
    df_clean['PC2'] = X_pca_2[:, 1]

    # 7. K-Means Optimization Curves (k=2 to 8)
    elbow_data = []
    for temp_k in range(2, 9):
        if total_days < temp_k:
            continue
        km = KMeans(n_clusters=temp_k, random_state=42, n_init=10)
        km_labels = km.fit_predict(X_scaled)
        inertia = float(km.inertia_)
        sil = float(silhouette_score(X_scaled, km_labels))
        elbow_data.append({
            'k': temp_k,
            'inertia': inertia,
            'silhouette': sil
        })

    # 8. Forced K-Means (K=k) & Centroid return-sorting dynamic label map
    kmeans_k = KMeans(n_clusters=k, random_state=42, n_init=10)
    kmeans_k.fit(X_scaled)
    labels_k = kmeans_k.labels_
    
    cluster_returns = []
    for c in range(k):
        mask = (labels_k == c)
        avg_ret = df_clean.loc[mask, 'mean_ret_21'].mean()
        cluster_returns.append((c, avg_ret))
        
    # Sort cluster IDs by return ascending
    sorted_clusters = sorted(cluster_returns, key=lambda x: x[1])
    label_map = {sorted_clusters[idx][0]: idx for idx in range(k)}
    df_clean['Regime'] = [label_map[l] for l in labels_k]

    # 9. Summary metrics
    final_regimes = df_clean['Regime'].values
    silhouette = float(silhouette_score(X_scaled, final_regimes))
    db_index = float(davies_bouldin_score(X_scaled, final_regimes))
    pc1_pct = float(pca_var[0] * 100)
    pc2_pct = float(pca_var[1] * 100)
    pc_cum_pct = pc1_pct + pc2_pct
    
    metrics = {
        'silhouette': silhouette,
        'db_index': db_index,
        'pc1_pct': pc1_pct,
        'pc_cum_pct': pc_cum_pct,
        'total_days': int(total_days)
    }

    # 10. Ward Linkage Hierarchical resampled
    df_monthly = df_clean.set_index('Date').resample('ME').mean().reset_index()
    X_monthly = df_monthly[feature_cols].values
    X_monthly_scaled = StandardScaler().fit_transform(X_monthly)
    linkage_matrix = sch.linkage(X_monthly_scaled, method='ward')

    # 11. Format Payload every 5th row
    df_5th = df_clean.iloc[::5]
    price_data = []
    for _, row in df_5th.iterrows():
        price_data.append({
            'date': row['Date'].strftime('%Y-%m-%d'),
            'price': float(row[benchmark_col]),
            'regime': int(row['Regime']),
            'volatility': float(row['vol_21']),
            'rsi': float(row['rsi_14'])
        })
        
    stock_data = {}
    for ticker in loaded_stocks:
        stock_data[ticker] = df_5th[ticker].astype(float).round(2).tolist()

    # PCA 800 sample
    df_pca_sample = df_clean.sample(n=min(800, len(df_clean)), random_state=42).sort_index()
    pca_data = []
    for _, row in df_pca_sample.iterrows():
        pca_data.append({
            'pc1': float(row['PC1']),
            'pc2': float(row['PC2']),
            'regime': int(row['Regime'])
        })

    # Pie shares
    regime_counts = df_clean['Regime'].value_counts()
    regime_names = {0: 'bear', 1: 'sideways', 2: 'bull'}
    pie_data = {}
    for c in range(k):
        key = regime_names.get(c, f"regime_{c}")
        pie_data[key] = float((regime_counts.get(c, 0) / total_days) * 100)

    # Summary table data
    summary_data = []
    for c in range(k):
        mask = (df_clean['Regime'] == c)
        df_r = df_clean[mask]
        
        count = len(df_r)
        pct = (count / total_days) * 100
        
        avg_ret = df_r['mean_ret_21'].mean() * 100
        avg_vol = df_r['vol_21'].mean() * 100
        avg_rsi = df_r['rsi_14'].mean()
        
        name_val = "Bear" if c == 0 else ("Sideways" if (c == 1 and k == 3) else ("Bull" if c == k - 1 else f"Regime {c}"))
        
        summary_data.append({
            'regime': c,
            'name': name_val,
            'days': int(count),
            'pct': float(pct),
            'avg_ret': float(avg_ret),
            'avg_vol': float(avg_vol),
            'avg_rsi': float(avg_rsi)
        })

    return {
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

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/api/data')
def get_data():
    try:
        # Check if we need to reset the custom CSV dataset
        if request.args.get('reset', 'false').lower() == 'true':
            global _CUSTOM_PRICE_CACHE
            _CUSTOM_PRICE_CACHE = None
            
        # Parse lookback and clustering parameters
        k = int(request.args.get('k', 3))
        vol_win = int(request.args.get('vol_win', 21))
        ret_win = int(request.args.get('ret_win', 21))
        mom_win = int(request.args.get('mom_win', 63))
        rsi_win = int(request.args.get('rsi_win', 14))
        
        # Parse selected stock list
        stocks_param = request.args.get('stocks', '')
        if stocks_param:
            selected_stocks = [s.strip() for s in stocks_param.split(',')]
        else:
            if _CUSTOM_PRICE_CACHE is not None:
                selected_stocks = _CUSTOM_PRICE_CACHE['stock_tickers']
            else:
                selected_stocks = STOCK_TICKERS

        # Run pipeline dynamically in-memory (takes <15ms)
        data = run_regime_pipeline(k, vol_win, ret_win, mom_win, rsi_win, selected_stocks)
        return jsonify(data)
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500

@app.route('/api/upload', methods=['POST'])
def upload_file():
    global _CUSTOM_PRICE_CACHE
    if 'file' not in request.files:
        return jsonify({'error': 'No file uploaded'}), 400
    file = request.files['file']
    if file.filename == '':
        return jsonify({'error': 'Empty file selected'}), 400
        
    try:
        df = pd.read_csv(file)
        
        # Locate date column
        date_col = None
        for c in df.columns:
            if 'date' in c.lower() or 'time' in c.lower() or 'timestamp' in c.lower():
                date_col = c
                break
        if date_col is None:
            return jsonify({'error': 'Could not find a Date column in CSV.'}), 400
            
        df['Date'] = pd.to_datetime(df[date_col])
        
        # Collect numeric price columns
        price_cols = []
        for c in df.columns:
            if c == date_col or c == 'Date':
                continue
            if pd.api.types.is_numeric_dtype(df[c]):
                price_cols.append(c)
                
        if not price_cols:
            return jsonify({'error': 'No numeric price columns found.'}), 400
            
        df = df.sort_values('Date').reset_index(drop=True)
        df_clean = df[['Date'] + price_cols].dropna()
        
        if len(df_clean) < 100:
            return jsonify({'error': 'Dataset is too small (requires at least 100 rows).'}), 400
            
        if len(price_cols) == 1:
            # Single asset mode: clone price column to serve as benchmark index
            ticker = price_cols[0]
            df_clean = df_clean.rename(columns={ticker: 'Close'})
            df_clean['Nifty50'] = df_clean['Close']
            _CUSTOM_PRICE_CACHE = {
                'df': df_clean[['Date', 'Nifty50', 'Close']].copy(),
                'stock_tickers': ['Close'],
                'short_names': {'Close': ticker[:12]}
            }
        else:
            # Multi asset mode: treat first column as index, remaining as stocks
            bench = price_cols[0]
            df_clean = df_clean.rename(columns={bench: 'Nifty50'})
            stocks = price_cols[1:]
            _CUSTOM_PRICE_CACHE = {
                'df': df_clean[['Date', 'Nifty50'] + stocks].copy(),
                'stock_tickers': stocks,
                'short_names': {s: s[:12] for s in stocks}
            }
            
        return jsonify({'success': True, 'stocks': _CUSTOM_PRICE_CACHE['stock_tickers']})
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({'error': f"Failed to parse CSV: {str(e)}"}), 500

if __name__ == '__main__':
    app.run(debug=True, host='127.0.0.1', port=5000)

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

def generate_regime_data():
    global _DATA_CACHE, _CACHE_TIMESTAMP
    
    # Check if cache is still valid
    if _DATA_CACHE is not None and (time.time() - _CACHE_TIMESTAMP) < CACHE_EXPIRY:
        return _DATA_CACHE

    print("[*] Downloading Nifty 50 index (^NSEI) data from Yahoo Finance...")
    df = yf.download("^NSEI", start="2010-01-01", end="2024-12-31")
    if df.empty:
        raise ValueError("No data returned for ^NSEI from Yahoo Finance.")
        
    df = df.reset_index()
    # Flatten columns if multi-indexed
    if isinstance(df.columns, pd.MultiIndex):
        df.columns = [col[0] for col in df.columns]
        
    df['Date'] = pd.to_datetime(df['Date'])
    df['Close'] = df['Close'].astype(float)
    
    # 1. Feature Engineering
    # Daily Log Return
    df['log_ret'] = np.log(df['Close'] / df['Close'].shift(1))
    
    # Feature A: 21-day rolling volatility (annualized)
    df['vol_21'] = df['log_ret'].rolling(window=21).std() * np.sqrt(252)
    
    # Feature B: 21-day mean return (annualized)
    df['mean_ret_21'] = df['log_ret'].rolling(window=21).mean() * 252
    
    # Feature C: 63-day momentum (log return over 3 months)
    df['mom_63'] = np.log(df['Close'] / df['Close'].shift(63))
    
    # Feature D: RSI-14
    df['rsi_14'] = compute_rsi(df['Close'], window=14)
    
    # Feature E: 50-day / 200-day Moving Average Ratio
    ma_50 = df['Close'].rolling(window=50).mean()
    ma_200 = df['Close'].rolling(window=200).mean()
    df['ma_50_200'] = ma_50 / ma_200
    
    # Drop rows containing NaNs
    df_clean = df.dropna().reset_index(drop=True)
    
    # 2. Scaling
    feature_cols = ['log_ret', 'vol_21', 'mean_ret_21', 'mom_63', 'rsi_14', 'ma_50_200']
    X = df_clean[feature_cols].values
    scaler = StandardScaler()
    X_scaled = scaler.fit_transform(X)
    
    # 3. PCA Calculations
    # Full PCA for explained variance ratios
    pca_full = PCA()
    pca_full.fit(X_scaled)
    pca_var = pca_full.explained_variance_ratio_.tolist()
    
    # 2-Component PCA for 2D visualization
    pca_2 = PCA(n_components=2)
    X_pca_2 = pca_2.fit_transform(X_scaled)
    df_clean['PC1'] = X_pca_2[:, 0]
    df_clean['PC2'] = X_pca_2[:, 1]
    
    # 4. K-Means Elbow and Silhouette analysis (K=2 to 8)
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
        
    # 5. Forced K-Means (K=3) & Dynamic Mapping (ranked by annualized 21d mean return)
    kmeans_3 = KMeans(n_clusters=3, random_state=42, n_init=10)
    kmeans_3.fit(X_scaled)
    labels_3 = kmeans_3.labels_
    
    # Compute mean 21d return for each cluster to rank them:
    # Lowest -> Bear (0), Middle -> Sideways (1), Highest -> Bull (2)
    cluster_returns = []
    for c in range(3):
        mask = (labels_3 == c)
        avg_ret = df_clean.loc[mask, 'mean_ret_21'].mean()
        cluster_returns.append((c, avg_ret))
        
    # Sort cluster indices based on average return ascending
    sorted_clusters = sorted(cluster_returns, key=lambda x: x[1])
    label_map = {
        sorted_clusters[0][0]: 0,  # Lowest return = Bear
        sorted_clusters[1][0]: 1,  # Middle return = Sideways
        sorted_clusters[2][0]: 2   # Highest return = Bull
    }
    
    # Assign sorted logical regimes
    df_clean['Regime'] = [label_map[l] for l in labels_3]
    
    # 6. Overall Metrics (Silhouette, DB Index, PCA Explained)
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
        'pc_cum_pct': pc_cum_pct
    }
    
    # 7. Ward Hierarchical Clustering on Monthly Resampled Data
    df_monthly = df_clean.set_index('Date').resample('ME').mean().reset_index()
    X_monthly = df_monthly[feature_cols].values
    X_monthly_scaled = StandardScaler().fit_transform(X_monthly)
    
    # Ward Linkage matrix
    linkage_matrix = sch.linkage(X_monthly_scaled, method='ward')
    
    # Monthly Agglomerative Clustering
    ac_monthly = AgglomerativeClustering(n_clusters=3, linkage='ward')
    monthly_labels = ac_monthly.fit_predict(X_monthly_scaled)
    
    # Map monthly labels logically as well
    monthly_returns = []
    for c in range(3):
        mask = (monthly_labels == c)
        avg_ret = df_monthly.loc[mask, 'mean_ret_21'].mean()
        monthly_returns.append((c, avg_ret))
    sorted_monthly = sorted(monthly_returns, key=lambda x: x[1])
    monthly_map = {
        sorted_monthly[0][0]: 0,
        sorted_monthly[1][0]: 1,
        sorted_monthly[2][0]: 2
    }
    monthly_regimes = [monthly_map[l] for l in monthly_labels]
    
    hierarchical_data = {
        'dates': df_monthly['Date'].dt.strftime('%Y-%m-%d').tolist(),
        'prices': df_monthly['Close'].astype(float).round(2).tolist(),
        'regimes': [int(l) for l in monthly_regimes],
        'linkage': linkage_matrix.tolist()
    }
    
    # 8. Slicing API outputs
    # Every 5th row for daily price timeline
    df_5th = df_clean.iloc[::5]
    price_data = []
    for _, row in df_5th.iterrows():
        price_data.append({
            'date': row['Date'].strftime('%Y-%m-%d'),
            'price': float(row['Close']),
            'regime': int(row['Regime']),
            'volatility': float(row['vol_21']),
            'rsi': float(row['rsi_14'])
        })
        
    # 800-row sample for PCA scatter plot
    df_pca_sample = df_clean.sample(n=min(800, len(df_clean)), random_state=42).sort_index()
    pca_data = []
    for _, row in df_pca_sample.iterrows():
        pca_data.append({
            'pc1': float(row['PC1']),
            'pc2': float(row['PC2']),
            'regime': int(row['Regime'])
        })
        
    # Pie Chart distribution data
    regime_counts = df_clean['Regime'].value_counts()
    total_days = len(df_clean)
    pie_data = {
        'bear': float((regime_counts.get(0, 0) / total_days) * 100),
        'sideways': float((regime_counts.get(1, 0) / total_days) * 100),
        'bull': float((regime_counts.get(2, 0) / total_days) * 100)
    }
    
    # Summary Statistics Table data
    summary_data = []
    names = {0: "Bear", 1: "Sideways", 2: "Bull"}
    for r in [0, 1, 2]:
        mask = (df_clean['Regime'] == r)
        df_r = df_clean[mask]
        
        count = len(df_r)
        pct = (count / total_days) * 100
        
        # Calculate stats
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
        
    # Store everything in cache
    _DATA_CACHE = {
        'price_data': price_data,
        'pca_data': pca_data,
        'pie_data': pie_data,
        'summary_data': summary_data,
        'elbow_data': elbow_data,
        'pca_var': pca_var,
        'metrics': metrics,
        'hierarchical_data': hierarchical_data,
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
            
        data = generate_regime_data()
        return jsonify(data)
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500

if __name__ == '__main__':
    # Flask runs locally on port 5000 by default
    app.run(debug=True, host='127.0.0.1', port=5000)

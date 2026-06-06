#!/usr/bin/env python3
"""
Equity Market Regime Analysis CLI Utility
Author: Antigravity Quant Team
Identifies Bull, Bear, and Sideways regimes using PCA, K-Means, and Hierarchical Clustering.
"""

import os
import argparse
import numpy as np
import pandas as pd
import matplotlib.pyplot as plt
import seaborn as sns
import yfinance as yf
from sklearn.preprocessing import StandardScaler
from sklearn.decomposition import PCA
from sklearn.cluster import KMeans
import scipy.cluster.hierarchy as sch

# Setup plot styles for a modern dark-sleek aesthetic
sns.set_theme(style="darkgrid")
plt.rcParams.update({
    'figure.facecolor': '#090d16',
    'axes.facecolor': '#111827',
    'text.color': '#f8fafc',
    'axes.labelcolor': '#94a3b8',
    'xtick.color': '#94a3b8',
    'ytick.color': '#94a3b8',
    'grid.color': '#1e293b',
    'font.family': 'sans-serif'
})

def fetch_data(ticker, start, end):
    print(f"[*] Downloading {ticker} data from {start} to {end}...")
    df = yf.download(ticker, start=start, end=end)
    if df.empty:
        raise ValueError(f"No data returned for ticker {ticker}")
    df = df.reset_index()
    # Flatten columns if multi-indexed
    if isinstance(df.columns, pd.MultiIndex):
        df.columns = [col[0] for col in df.columns]
    
    if 'Close' in df.columns:
        df = df[['Date', 'Close']].copy()
    elif 'Adj Close' in df.columns:
        df = df[['Date', 'Adj Close']].copy().rename(columns={'Adj Close': 'Close'})
    else:
        raise ValueError("Could not find Close or Adj Close price columns.")
        
    df['Date'] = pd.to_datetime(df['Date'])
    df['Close'] = df['Close'].astype(float)
    return df

def feature_engineering(df, r_window, v_window, d_window):
    print("[*] Generating rolling features...")
    # Daily returns
    df['Daily_Return'] = df['Close'].pct_change()
    
    # 1. Rolling returns
    df['Rolling_Return'] = df['Close'].pct_change(periods=r_window)
    
    # 2. Rolling Volatility (annualized std dev of daily returns)
    df['Rolling_Vol'] = df['Daily_Return'].rolling(window=v_window).std() * np.sqrt(252)
    
    # 3. Rolling Drawdown
    rolling_max = df['Close'].rolling(window=d_window, min_periods=1).max()
    df['Rolling_DD'] = (rolling_max - df['Close']) / rolling_max
    
    # Drop rows with NaN
    df_clean = df.dropna().reset_index(drop=True)
    return df_clean

def run_clustering_and_pca(df, k_clusters):
    print("[*] Performing standard scaling...")
    features = ['Rolling_Return', 'Rolling_Vol', 'Rolling_DD']
    X = df[features].values
    
    scaler = StandardScaler()
    X_scaled = scaler.fit_transform(X)
    
    print("[*] Applying PCA...")
    pca = PCA(n_components=2)
    X_pca = pca.fit_transform(X_scaled)
    
    print(f"    - PC1 Explained Variance: {pca.explained_variance_ratio_[0]*100:.2f}%")
    print(f"    - PC2 Explained Variance: {pca.explained_variance_ratio_[1]*100:.2f}%")
    print(f"    - Cumulative Variance Explained: {np.sum(pca.explained_variance_ratio_)*100:.2f}%")
    
    print("[*] Running K-Means Clustering...")
    kmeans = KMeans(n_clusters=k_clusters, random_state=42, init='k-means++')
    kmeans.fit(X_scaled)
    labels = kmeans.labels_
    
    # Profile clusters to order them logically:
    # 0 = Bear (lowest returns, highest vol), 1 = Sideways, 2 = Bull (highest returns)
    cluster_means = []
    for c in range(k_clusters):
        c_mask = (labels == c)
        avg_ret = df.loc[c_mask, 'Rolling_Return'].mean()
        avg_vol = df.loc[c_mask, 'Rolling_Vol'].mean()
        cluster_means.append({'id': c, 'avg_ret': avg_ret, 'avg_vol': avg_vol})
        
    # Sort cluster IDs by average returns ascending
    sorted_clusters = sorted(cluster_means, key=lambda x: x['avg_ret'])
    
    mapping = {}
    if k_clusters == 3:
        mapping[sorted_clusters[0]['id']] = 0 # Lowest return -> Bear
        mapping[sorted_clusters[1]['id']] = 1 # Middle return -> Sideways
        mapping[sorted_clusters[2]['id']] = 2 # Highest return -> Bull
    else:
        for idx, item in enumerate(sorted_clusters):
            mapping[item['id']] = idx
            
    logical_labels = np.array([mapping[l] for l in labels])
    df['Regime'] = logical_labels
    
    return X_scaled, X_pca, pca, df

def plot_regimes(df, ticker, output_dir):
    print("[*] Plotting Price Regime Chart...")
    fig, ax = plt.subplots(figsize=(14, 7))
    
    dates = df['Date'].values
    prices = df['Close'].values
    regimes = df['Regime'].values
    
    # Color mappings
    colors = {0: '#f43f5e', 1: '#f59e0b', 2: '#10b981', 3: '#64748b'} # Bear, Sideways, Bull, Gray
    labels = {0: 'Bear Regime', 1: 'Sideways Regime', 2: 'Bull Regime', 3: 'Other'}
    
    # Plot baseline price line
    ax.plot(dates, prices, color='#e2e8f0', linewidth=1.5, alpha=0.8, label=f"{ticker} Close Price")
    
    # Color vertical backgrounds based on regimes
    for i in range(len(df) - 1):
        r = regimes[i]
        ax.axvspan(dates[i], dates[i+1], color=colors.get(r, '#64748b'), alpha=0.15, zorder=1)
    
    # Segmented colored scatter dots on top to highlight regime periods
    for r in np.unique(regimes):
        mask = (regimes == r)
        ax.scatter(dates[mask], prices[mask], color=colors.get(r, '#64748b'), s=4, label=labels.get(r, f'Regime {r}'), zorder=2)
        
    ax.set_title(f"{ticker} Market Regime Analysis (PCA & K-Means)", fontsize=14, fontweight='semibold', pad=15)
    ax.set_xlabel("Date", fontsize=12, labelpad=10)
    ax.set_ylabel("Price ($)", fontsize=12, labelpad=10)
    ax.legend(loc="upper left", frameon=True, facecolor='#111827', edgecolor='#1e293b')
    
    fig.tight_layout()
    chart_path = os.path.join(output_dir, "regime_chart.png")
    fig.savefig(chart_path, dpi=300, facecolor=fig.get_facecolor(), edgecolor='none')
    plt.close(fig)
    print(f"    - Saved regime chart to {chart_path}")

def plot_pca_scatter(X_pca, regimes, k_clusters, output_dir):
    print("[*] Plotting PCA Scatter Space...")
    fig, ax = plt.subplots(figsize=(8, 6))
    
    colors = {0: '#f43f5e', 1: '#f59e0b', 2: '#10b981', 3: '#64748b'}
    labels = {0: 'Bear Cluster', 1: 'Sideways Cluster', 2: 'Bull Cluster', 3: 'Other'}
    
    for r in range(k_clusters):
        mask = (regimes == r)
        ax.scatter(X_pca[mask, 0], X_pca[mask, 1], 
                   color=colors.get(r, '#64748b'), 
                   label=labels.get(r, f'Cluster {r}'), 
                   alpha=0.7, edgecolors='none', s=25)
        
    ax.set_title("2D Principal Component Projection", fontsize=12, fontweight='semibold', pad=12)
    ax.set_xlabel("PC1", fontsize=10, labelpad=8)
    ax.set_ylabel("PC2", fontsize=10, labelpad=8)
    ax.legend(frameon=True, facecolor='#111827', edgecolor='#1e293b')
    
    fig.tight_layout()
    pca_path = os.path.join(output_dir, "pca_scatter.png")
    fig.savefig(pca_path, dpi=300, facecolor=fig.get_facecolor(), edgecolor='none')
    plt.close(fig)
    print(f"    - Saved PCA scatter to {pca_path}")

def plot_dendrogram(X_scaled, df, output_dir, limit=150):
    print(f"[*] Plotting Hierarchical Dendrogram for recent {limit} trading days...")
    # Slice the last 'limit' trading days
    X_slice = X_scaled[-limit:]
    dates_slice = df['Date'].dt.strftime('%m-%d').values[-limit:]
    
    linkage_matrix = sch.linkage(X_slice, method='average')
    
    fig, ax = plt.subplots(figsize=(12, 6))
    
    # Custom color palette for dendrogram
    sch.set_link_color_palette(['#3b82f6', '#10b981', '#f43f5e', '#f59e0b'])
    
    sch.dendrogram(
        linkage_matrix, 
        labels=dates_slice,
        leaf_rotation=90,
        leaf_font_size=7,
        color_threshold=0.6 * max(linkage_matrix[:, 2]),
        ax=ax,
        above_threshold_color='#64748b'
    )
    
    ax.set_title("Hierarchical Agglomerative Dendrogram (Average Linkage)", fontsize=12, fontweight='semibold', pad=12)
    ax.set_ylabel("Euclidean Distance", fontsize=10, labelpad=8)
    
    fig.tight_layout()
    dend_path = os.path.join(output_dir, "dendrogram.png")
    fig.savefig(dend_path, dpi=300, facecolor=fig.get_facecolor(), edgecolor='none')
    plt.close(fig)
    print(f"    - Saved dendrogram to {dend_path}")

def display_regime_statistics(df, k_clusters):
    print("\n" + "="*70)
    print("                      REGIME SUMMARY STATISTICS")
    print("="*70)
    
    regime_names = {0: 'Bear', 1: 'Sideways', 2: 'Bull'}
    
    # Calculate stats per regime
    summary_data = []
    for r in range(k_clusters):
        mask = (df['Regime'] == r)
        sub_df = df[mask]
        
        count = len(sub_df)
        pct = (count / len(df)) * 100
        avg_ret = sub_df['Rolling_Return'].mean() * 100
        avg_vol = sub_df['Rolling_Vol'].mean() * 100
        max_dd = sub_df['Rolling_DD'].max() * 100
        
        name = regime_names.get(r, f"Regime {r}")
        summary_data.append([name, count, f"{pct:.1f}%", f"{avg_ret:+.3f}%", f"{avg_vol:.1f}%", f"{max_dd:.1f}%"])
        
    stats_df = pd.DataFrame(summary_data, columns=['Regime Name', 'Days', '% of Total', 'Avg Ret (21d)', 'Avg Vol (Ann)', 'Max Drawdown'])
    print(stats_df.to_string(index=False))
    print("="*70)

def main():
    parser = argparse.ArgumentParser(description="Equity Market Regime Analysis CLI Tool")
    parser.add_argument("--ticker", type=str, default="SPY", help="Yahoo Finance Ticker (default: SPY)")
    parser.add_argument("--start", type=str, default="2023-01-01", help="Start Date (YYYY-MM-DD)")
    parser.add_argument("--end", type=str, default="2026-06-01", help="End Date (YYYY-MM-DD)")
    parser.add_argument("--k", type=int, default=3, help="Number of Clusters K (default: 3)")
    parser.add_argument("--ret-window", type=int, default=21, help="Rolling return lookback (default: 21)")
    parser.add_argument("--vol-window", type=int, default=21, help="Rolling vol lookback (default: 21)")
    parser.add_argument("--dd-window", type=int, default=21, help="Rolling drawdown lookback (default: 21)")
    parser.add_argument("--output-dir", type=str, default=".", help="Directory to save image artifacts")
    
    args = parser.parse_args()
    
    # Ensure output dir exists
    os.makedirs(args.output_dir, exist_ok=True)
    
    try:
        # Pipeline
        df = fetch_data(args.ticker, args.start, args.end)
        df_features = feature_engineering(df, args.ret_window, args.vol_window, args.dd_window)
        X_scaled, X_pca, pca_model, df_results = run_clustering_and_pca(df_features, args.k)
        
        # Plotting & Stats
        plot_regimes(df_results, args.ticker, args.output_dir)
        plot_pca_scatter(X_pca, df_results['Regime'].values, args.k, args.output_dir)
        plot_dendrogram(X_scaled, df_results, args.output_dir, limit=150)
        display_regime_statistics(df_results, args.k)
        
        print("\n[*] Regime analysis completed successfully!")
    except Exception as e:
        print(f"\n[!] Error during execution: {e}")

if __name__ == "__main__":
    main()

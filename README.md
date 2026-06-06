# Nifty 50 Market Regime Dynamics
### Full-Stack Quantitative Analysis Web Application (Flask Backend + Single-Page Chart.js Frontend)

This application is a full-stack dashboard that retrieves daily historical Nifty 50 Index (`^NSEI`) data from **2010 to 2024**, engineers 6 quantitative features, standardizes them, runs PCA and K-Means clustering, and visualizes the results on a single-page interactive dashboard.

---

## 🛠️ Tech Stack & Directory Structure

```
capital/
├── app.py                      # Flask App (Calculations engine & JSON API endpoints)
├── requirements.txt            # Python Dependencies
├── templates/
│   └── index.html              # Dashboard Template (headings in Syne, content fade-ins)
├── static/
│   ├── css/
│   │   └── style.css           # Premium Space Dark UI (#050d1a, glow accents, responsive grid)
│   └── js/
│       └── app.js              # Frontend Controller (Fetch handler, segmented Chart.js, IntersectionObserver)
└── README.md                   # Setup guide and documentation
```

---

## 📐 Quantitative Pipeline (Backend)

### 1. Feature Engineering
The pipeline processes 6 distinct daily metrics:
*   **Daily Log Return:** $r_t = \ln(Close_t / Close_{t-1})$
*   **21-day Annualized Volatility:** Standard deviation of daily returns over 21 days multiplied by $\sqrt{252}$
*   **21-day Annualized Mean Return:** Mean of daily returns over 21 days multiplied by $252$
*   **63-day Momentum:** Log return over 63 trading days (approx. 3 months): $\ln(Close_t / Close_{t-63})$
*   **RSI-14:** Wilder's Relative Strength Index calculated with exponential smoothing
*   **50d/200d Moving Average Ratio:** $SMA_{50} / SMA_{200}$ to capture long-term macro trend alignments

### 2. PCA & K-Means Dynamic Labeling
*   Data is normalized using `StandardScaler`.
*   PCA is performed to explain variance and reduce feature space.
*   K-Means is fitted for $K=3$. To guarantee that regimes are assigned logically under any market conditions, **centroids are ranked dynamically by their 21-day annualized mean return**:
    *   🔴 **Bear (0):** Lowest average returns cluster
    *   🟡 **Sideways (1):** Middle average returns cluster
    *   🟢 **Bull (2):** Highest average returns cluster
*   Elbow inertia and silhouette values are computed for $k = 2\dots 8$ to evaluate model optimization.

### 3. Monthly resampled Ward Linkage
*   The daily dataset is downsampled using `.resample("ME").mean()` to capture month-end macro averages.
*   Agglomerative Clustering runs on these monthly features using the **Ward variance-minimization linkage criterion**.

---

## 🚀 How to Run the App

### Step 1: Install Dependencies
Ensure you are in the project folder and run:
```bash
pip install -r requirements.txt
```

### Step 2: Launch the Flask Server
Run the Flask server script:
```bash
python app.py
```
By default, the server will fetch Nifty 50 data, calculate the model cache in memory, and listen locally:
🌐 **[http://127.0.0.1:5000](http://127.0.0.1:5000)**

---

## 📊 Dashboard Sections
1.  **Price Timeline:** Nifty 50 Close price segment-colored by active regime (Bear, Sideways, Bull) using contiguous connecting lines (`spanGaps: false`).
2.  **Volatility & RSI:** Volatility filled area chart combined with RSI-14 line chart on a dual y-axis with 70/30 dashed lines.
3.  **Model Optimization:** Elbow curve alongside a bar chart comparing silhouette scores for K=2 to 8.
4.  **PCA Space:** 2D scatter visualization of clusters in PCA coordinates alongside a bar/line combo chart showing explained variance.
5.  **Regime Profiles:** Doughnut chart detailing historical percentage distribution alongside a summary stats table with colored badges.
6.  **Methodology Reference:** Card grid summarizing formulas, standardization, and monthly Ward linkages.

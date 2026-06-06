/**
 * Nifty 50 Market Regime Analytics Frontend Controller
 */

document.addEventListener("DOMContentLoaded", () => {
    // Fetch API Data from Flask endpoint
    fetch("/api/data")
        .then(response => {
            if (!response.ok) {
                throw new Error("Failed to load quant data from Flask API");
            }
            return response.json();
        })
        .then(data => {
            // Populate KPI values
            document.getElementById("kpi-days").textContent = data.metrics.total_days.toLocaleString();
            document.getElementById("kpi-silhouette").textContent = data.metrics.silhouette.toFixed(3);
            document.getElementById("kpi-pc1").textContent = data.metrics.pc1_pct.toFixed(1) + "%";
            document.getElementById("kpi-pccum").textContent = data.metrics.pc_cum_pct.toFixed(1) + "%";

            // Render all dashboard charts
            renderPriceChart(data.price_data);
            renderStockComparisonChart(data.price_data, data.stock_data);
            drawCorrelationHeatmap(data.correlation_matrix);
            renderIndicatorsChart(data.price_data);
            renderElbowAndSilhouette(data.elbow_data);
            renderPCACharts(data.pca_data, data.pca_var);
            renderBreakdown(data.pie_data, data.summary_data);

            // Initialize scroll animations
            initScrollAnimations();

            // Dismiss Loading Screen
            const loader = document.getElementById("loadingScreen");
            loader.classList.add("fade-out");
            setTimeout(() => loader.remove(), 500);
        })
        .catch(error => {
            console.error("Error loading dashboard data:", error);
            const loaderText = document.querySelector(".loading-text");
            if (loaderText) {
                loaderText.textContent = "ERROR LOADING QUANT DATA: " + error.message;
                loaderText.style.color = "#ef4444";
            }
        });
});

/**
 * 1. SECTION 1: PRICE TIMELINE (Regime Colored Segments)
 */
function renderPriceChart(priceData) {
    const dates = priceData.map(d => d.date);
    const prices = priceData.map(d => d.price);
    const regimes = priceData.map(d => d.regime);

    const bearPrices = [];
    const sidewaysPrices = [];
    const bullPrices = [];

    for (let i = 0; i < prices.length; i++) {
        const r = regimes[i];
        const p = prices[i];

        // Bear (0)
        if (r === 0 || (i > 0 && regimes[i - 1] === 0)) {
            bearPrices.push(p);
        } else {
            bearPrices.push(null);
        }

        // Sideways (1)
        if (r === 1 || (i > 0 && regimes[i - 1] === 1)) {
            sidewaysPrices.push(p);
        } else {
            sidewaysPrices.push(null);
        }

        // Bull (2)
        if (r === 2 || (i > 0 && regimes[i - 1] === 2)) {
            bullPrices.push(p);
        } else {
            bullPrices.push(null);
        }
    }

    const ctx = document.getElementById("priceChart").getContext("2d");
    new Chart(ctx, {
        type: 'line',
        data: {
            labels: dates,
            datasets: [
                {
                    label: 'Bear Market',
                    data: bearPrices,
                    borderColor: '#ef4444',
                    borderWidth: 2,
                    pointRadius: 0,
                    spanGaps: false,
                    fill: false
                },
                {
                    label: 'Sideways Market',
                    data: sidewaysPrices,
                    borderColor: '#f59e0b',
                    borderWidth: 2,
                    pointRadius: 0,
                    spanGaps: false,
                    fill: false
                },
                {
                    label: 'Bull Market',
                    data: bullPrices,
                    borderColor: '#22c55e',
                    borderWidth: 2,
                    pointRadius: 0,
                    spanGaps: false,
                    fill: false
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                x: {
                    grid: { color: 'rgba(255, 255, 255, 0.03)' },
                    ticks: {
                        color: '#94a3b8',
                        maxTicksLimit: 12,
                        font: { family: 'Outfit', size: 11 }
                    }
                },
                y: {
                    grid: { color: 'rgba(255, 255, 255, 0.03)' },
                    ticks: {
                        color: '#94a3b8',
                        font: { family: 'Outfit', size: 11 }
                    }
                }
            },
            plugins: {
                legend: {
                    position: 'top',
                    labels: {
                        color: '#f8fafc',
                        font: { family: 'Outfit', size: 12 },
                        usePointStyle: true
                    }
                },
                tooltip: {
                    intersect: false,
                    mode: 'index',
                    titleFont: { family: 'Outfit', size: 13 },
                    bodyFont: { family: 'Outfit', size: 12 },
                    backgroundColor: 'rgba(5, 13, 26, 0.95)',
                    borderColor: 'rgba(255, 255, 255, 0.1)',
                    borderWidth: 1
                }
            }
        }
    });
}

/**
 * 2. SECTION 2: MULTI-LINE STOCK COMPARISON CHART (Normalized to 100)
 */
function renderStockComparisonChart(priceData, stockData) {
    const dates = priceData.map(d => d.date);
    
    // Distinct colors for the 8 stocks
    const colors = [
        '#3b82f6', // Reliance (Blue)
        '#10b981', // TCS (Green)
        '#ef4444', // HDFC Bank (Red)
        '#f59e0b', // Infosys (Amber)
        '#8b5cf6', // ICICI Bank (Purple)
        '#ec4899', // Wipro (Pink)
        '#06b6d4', // Bajaj Finance (Cyan)
        '#e2e8f0'  // Maruti Suzuki (White)
    ];

    const shortNames = {
        "RELIANCE.NS": "Reliance",
        "TCS.NS": "TCS",
        "HDFCBANK.NS": "HDFC Bank",
        "INFY.NS": "Infosys",
        "ICICIBANK.NS": "ICICI Bank",
        "WIPRO.NS": "Wipro",
        "BAJFINANCE.NS": "Bajaj Fin",
        "MARUTI.NS": "Maruti"
    };

    const datasets = Object.keys(stockData).map((ticker, index) => {
        const prices = stockData[ticker];
        const startPrice = prices[0];
        
        // Normalize: Price_t / Price_0 * 100
        const normalizedPrices = prices.map(p => startPrice === 0 ? 0 : (p / startPrice) * 100);
        const color = colors[index % colors.length];

        return {
            label: shortNames[ticker] || ticker,
            data: normalizedPrices,
            borderColor: color,
            borderWidth: 1.8,
            pointRadius: 0,
            fill: false,
            tension: 0.05
        };
    });

    const ctx = document.getElementById("stockComparisonChart").getContext("2d");
    new Chart(ctx, {
        type: 'line',
        data: {
            labels: dates,
            datasets: datasets
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                x: {
                    grid: { color: 'rgba(255, 255, 255, 0.03)' },
                    ticks: {
                        color: '#94a3b8',
                        maxTicksLimit: 12,
                        font: { family: 'Outfit', size: 11 }
                    }
                },
                y: {
                    grid: { color: 'rgba(255, 255, 255, 0.03)' },
                    title: {
                        display: true,
                        text: 'Performance Index (Normalized to 100)',
                        color: '#94a3b8',
                        font: { family: 'Outfit', size: 12 }
                    },
                    ticks: {
                        color: '#94a3b8',
                        font: { family: 'Outfit', size: 11 }
                    }
                }
            },
            plugins: {
                legend: {
                    position: 'top',
                    labels: {
                        color: '#f8fafc',
                        font: { family: 'Outfit', size: 11 },
                        usePointStyle: true
                    }
                },
                tooltip: {
                    intersect: false,
                    mode: 'index',
                    titleFont: { family: 'Outfit', size: 13 },
                    bodyFont: { family: 'Outfit', size: 12 },
                    backgroundColor: 'rgba(5, 13, 26, 0.95)',
                    borderColor: 'rgba(255, 255, 255, 0.1)',
                    borderWidth: 1,
                    callbacks: {
                        label: function(context) {
                            return `${context.dataset.label}: ${context.parsed.y.toFixed(1)}`;
                        }
                    }
                }
            }
        }
    });
}

/**
 * 3. SECTION 3: PAIRWISE CORRELATION HEATMAP (Canvas Element)
 */
function drawCorrelationHeatmap(correlationData) {
    const canvas = document.getElementById("heatmapCanvas");
    if (!canvas) return;
    const ctx = canvas.getContext("2d");

    const matrix = correlationData.matrix;
    const labels = correlationData.labels;
    const n = matrix.length;

    // Dimensions
    const width = canvas.width;
    const height = canvas.height;
    const paddingLeft = 85;
    const paddingTop = 35;
    const paddingRight = 35;
    const paddingBottom = 85;

    const plotWidth = width - paddingLeft - paddingRight;
    const plotHeight = height - paddingTop - paddingBottom;
    const cellSize = plotWidth / n;

    // Clear Canvas
    ctx.clearRect(0, 0, width, height);

    // Diverging Color scale: Blue (Negative) -> Slate (Neutral) -> Red (Positive)
    function getColor(v) {
        let r, g, b;
        if (v >= 0) {
            // Interpolate between Slate background (30, 41, 59) and Red (239, 68, 68)
            r = Math.round(30 + v * (239 - 30));
            g = Math.round(41 + v * (68 - 41));
            b = Math.round(59 + v * (68 - 59));
        } else {
            // Interpolate between Slate (30, 41, 59) and Blue (59, 130, 246)
            const absV = Math.abs(v);
            r = Math.round(30 + absV * (59 - 30));
            g = Math.round(41 + absV * (130 - 41));
            b = Math.round(59 + absV * (246 - 59));
        }
        return `rgb(${r}, ${g}, ${b})`;
    }

    // Draw grid cells and correlation values
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = "bold 9px 'DM Mono', monospace";

    for (let i = 0; i < n; i++) {
        for (let j = 0; j < n; j++) {
            const val = matrix[i][j];
            const cellX = paddingLeft + j * cellSize;
            const cellY = paddingTop + i * cellSize;

            // Draw box
            ctx.fillStyle = getColor(val);
            ctx.fillRect(cellX, cellY, cellSize - 1, cellSize - 1);

            // Draw number inside
            ctx.fillStyle = "#ffffff";
            ctx.fillText(val.toFixed(2), cellX + cellSize / 2, cellY + cellSize / 2);
        }
    }

    // Draw labels
    ctx.fillStyle = "#94a3b8";
    ctx.font = "500 10px 'Outfit', sans-serif";

    // Y-axis labels (row names)
    ctx.textAlign = "right";
    for (let i = 0; i < n; i++) {
        const labelY = paddingTop + i * cellSize + cellSize / 2;
        ctx.fillText(labels[i], paddingLeft - 10, labelY);
    }

    // X-axis labels (col names, tilted 45 degrees)
    ctx.textAlign = "left";
    for (let j = 0; j < n; j++) {
        const labelX = paddingLeft + j * cellSize + cellSize / 2;
        ctx.save();
        ctx.translate(labelX, height - paddingBottom + 10);
        ctx.rotate(Math.PI / 4); // 45 degrees rotation
        ctx.fillText(labels[j], 0, 0);
        ctx.restore();
    }
}

/**
 * 4. SECTION 4: VOLATILITY AREA + RSI LINE (Combo Dual-Axis)
 */
function renderIndicatorsChart(priceData) {
    const dates = priceData.map(d => d.date);
    const vols = priceData.map(d => d.volatility * 100); 
    const rsis = priceData.map(d => d.rsi);

    const ctx = document.getElementById("indicatorsChart").getContext("2d");
    new Chart(ctx, {
        type: 'line',
        data: {
            labels: dates,
            datasets: [
                {
                    type: 'line',
                    label: 'Annualized Volatility',
                    data: vols,
                    borderColor: '#3b82f6',
                    borderWidth: 1.5,
                    backgroundColor: 'rgba(59, 130, 246, 0.08)',
                    fill: true,
                    pointRadius: 0,
                    yAxisID: 'y-vol'
                },
                {
                    type: 'line',
                    label: 'RSI-14',
                    data: rsis,
                    borderColor: '#f59e0b',
                    borderWidth: 1.5,
                    fill: false,
                    pointRadius: 0,
                    yAxisID: 'y-rsi'
                },
                {
                    type: 'line',
                    label: 'Overbought (70)',
                    data: new Array(dates.length).fill(70),
                    borderColor: 'rgba(239, 68, 68, 0.3)',
                    borderWidth: 1,
                    borderDash: [4, 4],
                    pointRadius: 0,
                    fill: false,
                    yAxisID: 'y-rsi'
                },
                {
                    type: 'line',
                    label: 'Oversold (30)',
                    data: new Array(dates.length).fill(30),
                    borderColor: 'rgba(34, 197, 94, 0.3)',
                    borderWidth: 1,
                    borderDash: [4, 4],
                    pointRadius: 0,
                    fill: false,
                    yAxisID: 'y-rsi'
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                x: {
                    grid: { color: 'rgba(255, 255, 255, 0.03)' },
                    ticks: {
                        color: '#94a3b8',
                        maxTicksLimit: 12,
                        font: { family: 'Outfit', size: 11 }
                    }
                },
                'y-vol': {
                    type: 'linear',
                    position: 'left',
                    grid: { color: 'rgba(255, 255, 255, 0.03)' },
                    title: {
                        display: true,
                        text: 'Volatility (Annualized %)',
                        color: '#94a3b8',
                        font: { family: 'Outfit', size: 11 }
                    },
                    ticks: { color: '#94a3b8' }
                },
                'y-rsi': {
                    type: 'linear',
                    position: 'right',
                    min: 10,
                    max: 90,
                    grid: { drawOnChartArea: false },
                    title: {
                        display: true,
                        text: 'RSI-14',
                        color: '#94a3b8',
                        font: { family: 'Outfit', size: 11 }
                    },
                    ticks: { color: '#94a3b8' }
                }
            },
            plugins: {
                legend: {
                    position: 'top',
                    labels: {
                        color: '#f8fafc',
                        font: { family: 'Outfit', size: 11 },
                        filter: function(item) {
                            return !item.text.includes("Over");
                        }
                    }
                },
                tooltip: {
                    intersect: false,
                    mode: 'index',
                    titleFont: { family: 'Outfit', size: 13 },
                    bodyFont: { family: 'Outfit', size: 12 },
                    backgroundColor: 'rgba(5, 13, 26, 0.95)',
                    borderColor: 'rgba(255, 255, 255, 0.1)',
                    borderWidth: 1,
                    callbacks: {
                        label: function(context) {
                            if (context.dataset.label.includes("Over")) return null;
                            const val = context.parsed.y;
                            return `${context.dataset.label}: ${val.toFixed(2)}`;
                        }
                    }
                }
            }
        }
    });
}

/**
 * 5. SECTION 5: ELBOW + SILHOUETTE OPTIMIZATION
 */
function renderElbowAndSilhouette(elbowData) {
    const kVals = elbowData.map(d => d.k);
    const inertias = elbowData.map(d => d.inertia);
    const silhouettes = elbowData.map(d => d.silhouette);

    // Elbow Chart
    const ctxElbow = document.getElementById("elbowChart").getContext("2d");
    new Chart(ctxElbow, {
        type: 'line',
        data: {
            labels: kVals,
            datasets: [{
                label: 'Inertia',
                data: inertias,
                borderColor: '#3b82f6',
                borderWidth: 2,
                backgroundColor: 'rgba(59, 130, 246, 0.2)',
                pointRadius: 5,
                pointBackgroundColor: '#3b82f6',
                fill: false
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                x: {
                    title: { display: true, text: 'Number of Clusters (k)', color: '#94a3b8', font: { family: 'Outfit' } },
                    grid: { color: 'rgba(255, 255, 255, 0.03)' },
                    ticks: { color: '#94a3b8' }
                },
                y: {
                    title: { display: true, text: 'Inertia', color: '#94a3b8', font: { family: 'Outfit' } },
                    grid: { color: 'rgba(255, 255, 255, 0.03)' },
                    ticks: { color: '#94a3b8' }
                }
            },
            plugins: { legend: { display: false } }
        }
    });

    // Silhouette Chart
    const ctxSil = document.getElementById("silhouetteChart").getContext("2d");
    new Chart(ctxSil, {
        type: 'bar',
        data: {
            labels: kVals,
            datasets: [{
                label: 'Silhouette Score',
                data: silhouettes,
                backgroundColor: kVals.map(k => k === 3 ? '#22c55e' : 'rgba(59, 130, 246, 0.3)'),
                borderColor: kVals.map(k => k === 3 ? '#22c55e' : '#3b82f6'),
                borderWidth: 1,
                borderRadius: 4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                x: {
                    title: { display: true, text: 'Number of Clusters (k)', color: '#94a3b8', font: { family: 'Outfit' } },
                    grid: { color: 'rgba(255, 255, 255, 0.03)' },
                    ticks: { color: '#94a3b8' }
                },
                y: {
                    title: { display: true, text: 'Silhouette Score', color: '#94a3b8', font: { family: 'Outfit' } },
                    grid: { color: 'rgba(255, 255, 255, 0.03)' },
                    ticks: { color: '#94a3b8' }
                }
            },
            plugins: { legend: { display: false } }
        }
    });
}

/**
 * 6. SECTION 6: PCA SCATTER + EXPLAINED VARIANCE
 */
function renderPCACharts(pcaData, pcaVar) {
    const bearPoints = [];
    const sidewaysPoints = [];
    const bullPoints = [];

    pcaData.forEach(pt => {
        const pObj = { x: pt.pc1, y: pt.pc2 };
        if (pt.regime === 0) bearPoints.push(pObj);
        else if (pt.regime === 1) sidewaysPoints.push(pObj);
        else if (pt.regime === 2) bullPoints.push(pObj);
    });

    // PCA 2D Scatter
    const ctxScatter = document.getElementById("pcaScatterChart").getContext("2d");
    new Chart(ctxScatter, {
        type: 'scatter',
        data: {
            datasets: [
                { label: 'Bear Cluster', data: bearPoints, backgroundColor: '#ef4444', pointRadius: 4 },
                { label: 'Sideways Cluster', data: sidewaysPoints, backgroundColor: '#f59e0b', pointRadius: 4 },
                { label: 'Bull Cluster', data: bullPoints, backgroundColor: '#22c55e', pointRadius: 4 }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                x: {
                    title: { display: true, text: 'PC1', color: '#94a3b8', font: { family: 'Outfit' } },
                    grid: { color: 'rgba(255, 255, 255, 0.03)' },
                    ticks: { color: '#94a3b8' }
                },
                y: {
                    title: { display: true, text: 'PC2', color: '#94a3b8', font: { family: 'Outfit' } },
                    grid: { color: 'rgba(255, 255, 255, 0.03)' },
                    ticks: { color: '#94a3b8' }
                }
            },
            plugins: {
                legend: { labels: { color: '#f8fafc', usePointStyle: true, font: { family: 'Outfit' } } }
            }
        }
    });

    // PCA Explained Variance Combo (Bar + Line)
    const pcLabels = ['PC1', 'PC2', 'PC3', 'PC4', 'PC5', 'PC6'];
    const indVars = pcaVar.map(v => v * 100);
    const cumVars = [];
    let cumulative = 0;
    indVars.forEach(v => {
        cumulative += v;
        cumVars.push(cumulative);
    });

    const ctxVariance = document.getElementById("pcaVarianceChart").getContext("2d");
    new Chart(ctxVariance, {
        type: 'bar',
        data: {
            labels: pcLabels,
            datasets: [
                {
                    type: 'bar',
                    label: 'Individual Explained Var',
                    data: indVars,
                    backgroundColor: 'rgba(59, 130, 246, 0.6)',
                    borderColor: '#3b82f6',
                    borderWidth: 1,
                    yAxisID: 'y-ind',
                    borderRadius: 4
                },
                {
                    type: 'line',
                    label: 'Cumulative Explained Var',
                    data: cumVars,
                    borderColor: '#22c55e',
                    borderWidth: 2,
                    fill: false,
                    pointRadius: 4,
                    pointBackgroundColor: '#22c55e',
                    yAxisID: 'y-cum'
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                x: {
                    grid: { color: 'rgba(255, 255, 255, 0.03)' },
                    ticks: { color: '#94a3b8', font: { family: 'Outfit' } }
                },
                'y-ind': {
                    type: 'linear',
                    position: 'left',
                    title: { display: true, text: 'Individual Variance (%)', color: '#94a3b8', font: { family: 'Outfit' } },
                    grid: { color: 'rgba(255, 255, 255, 0.03)' },
                    ticks: { color: '#94a3b8' }
                },
                'y-cum': {
                    type: 'linear',
                    position: 'right',
                    max: 100,
                    title: { display: true, text: 'Cumulative Variance (%)', color: '#94a3b8', font: { family: 'Outfit' } },
                    grid: { drawOnChartArea: false },
                    ticks: { color: '#94a3b8' }
                }
            },
            plugins: {
                legend: { position: 'top', labels: { color: '#f8fafc', font: { family: 'Outfit', size: 10 } } }
            }
        }
    });
}

/**
 * 7. SECTION 7: DOUGHNUT + SUMMARY STATS TABLE
 */
function renderBreakdown(pieData, summaryData) {
    // Doughnut
    const ctxPie = document.getElementById("doughnutChart").getContext("2d");
    new Chart(ctxPie, {
        type: 'doughnut',
        data: {
            labels: ['Bear Regime', 'Sideways Regime', 'Bull Regime'],
            datasets: [{
                data: [pieData.bear, pieData.sideways, pieData.bull],
                backgroundColor: ['#ef4444', '#f59e0b', '#22c55e'],
                borderWidth: 1,
                borderColor: '#050d1a'
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: { color: '#f8fafc', font: { family: 'Outfit', size: 11 }, usePointStyle: true }
                }
            },
            cutout: '65%'
        }
    });

    // Summary Stats Table
    const tbody = document.getElementById("summaryTable").querySelector("tbody");
    tbody.innerHTML = "";

    summaryData.forEach(row => {
        const tr = document.createElement("tr");
        let badgeClass = "pill ";
        if (row.regime === 0) badgeClass += "bear";
        else if (row.regime === 1) badgeClass += "sideways";
        else badgeClass += "bull";

        tr.innerHTML = `
            <td><span class="${badgeClass}">${row.name}</span></td>
            <td>${row.days.toLocaleString()}</td>
            <td>${row.pct.toFixed(1)}%</td>
            <td style="color: ${row.avg_ret >= 0 ? '#22c55e' : '#ef4444'}">
                ${row.avg_ret >= 0 ? '+' : ''}${row.avg_ret.toFixed(2)}%
            </td>
            <td>${row.avg_vol.toFixed(1)}%</td>
            <td>${row.avg_rsi.toFixed(1)}</td>
        `;
        tbody.appendChild(tr);
    });
}

/**
 * IntersectionObserver setup for Scroll Animations
 */
function initScrollAnimations() {
    const sections = document.querySelectorAll(".fade-in-section");
    const observerOptions = {
        root: null,
        rootMargin: "0px",
        threshold: 0.15
    };

    const observer = new IntersectionObserver((entries, observer) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add("is-visible");
                observer.unobserve(entry.target);
            }
        });
    }, observerOptions);

    sections.forEach(sec => {
        observer.observe(sec);
    });
}

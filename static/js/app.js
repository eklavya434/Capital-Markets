/**
 * Nifty 50 Market Regime Analytics Frontend Controller
 */

// Global Chart instances to manage destruction and prevent memory/canvas reuse leaks
let priceChartInst = null;
let stockComparisonChartInst = null;
let elbowChartInst = null;
let silhouetteChartInst = null;
let pcaScatterChartInst = null;
let pcaVarianceChartInst = null;
let doughnutChartInst = null;

// Debouncer timer
let debounceTimer = null;

// Preset tickers list names map
const PRESET_STOCK_NAMES = {
    "RELIANCE.NS": "Reliance Industries",
    "TCS.NS": "TCS",
    "HDFCBANK.NS": "HDFC Bank",
    "INFY.NS": "Infosys",
    "ICICIBANK.NS": "ICICI Bank",
    "WIPRO.NS": "Wipro",
    "BAJFINANCE.NS": "Bajaj Finance",
    "MARUTI.NS": "Maruti Suzuki"
};

document.addEventListener("DOMContentLoaded", () => {
    // Render stock selection checkboxes initially with default presets
    renderStockCheckboxes(Object.keys(PRESET_STOCK_NAMES));

    // Bind slider input events to update labels and trigger debounced server requests
    const volWin = document.getElementById("volWin");
    const retWin = document.getElementById("retWin");
    const momWin = document.getElementById("momWin");
    const rsiWin = document.getElementById("rsiWin");
    const kNum = document.getElementById("kNum");

    const volVal = document.getElementById("volVal");
    const retVal = document.getElementById("retVal");
    const momVal = document.getElementById("momVal");
    const rsiVal = document.getElementById("rsiVal");
    const kVal = document.getElementById("kVal");

    volWin.addEventListener("input", () => { volVal.textContent = volWin.value + "d"; debouncedUpdate(); });
    retWin.addEventListener("input", () => { retVal.textContent = retWin.value + "d"; debouncedUpdate(); });
    momWin.addEventListener("input", () => { momVal.textContent = momWin.value + "d"; debouncedUpdate(); });
    rsiWin.addEventListener("input", () => { rsiVal.textContent = rsiWin.value + "d"; debouncedUpdate(); });
    kNum.addEventListener("input", () => { kVal.textContent = kNum.value; debouncedUpdate(); });

    // Custom CSV File Upload
    const fileInput = document.getElementById("csvUploadInput");
    fileInput.addEventListener("change", () => {
        const file = fileInput.files[0];
        if (!file) return;

        showFullPageLoading("PARSING & PROCESSING CUSTOM QUANT DATASETS...");

        const formData = new FormData();
        formData.append("file", file);

        fetch("/api/upload", {
            method: "POST",
            body: formData
        })
        .then(response => {
            if (!response.ok) {
                return response.json().then(err => { throw new Error(err.error || "Failed to upload file") });
            }
            return response.json();
        })
        .then(data => {
            if (data.success) {
                document.getElementById("dataModeBadge").textContent = "Custom Dataset Active";
                document.getElementById("resetBtn").style.display = "inline-block";

                // Re-render checkboxes with custom stock columns
                renderStockCheckboxes(data.stocks);

                // Fetch data for custom dataset
                updateDashboard();
            }
        })
        .catch(error => {
            console.error("Upload error:", error);
            hideFullPageLoading();
            alert("Upload failed: " + error.message);
        });
    });

    // Reset button to presets
    const resetBtn = document.getElementById("resetBtn");
    resetBtn.addEventListener("click", () => {
        showFullPageLoading("RESTORING DEFAULT NIFTY 50 & 8 BLUECHIP PRESETS...");

        fetch("/api/data?reset=true")
            .then(response => response.json())
            .then(data => {
                resetBtn.style.display = "none";
                document.getElementById("dataModeBadge").textContent = "Default Presets Active";
                fileInput.value = "";

                // Restore default stock selection checkboxes
                renderStockCheckboxes(Object.keys(PRESET_STOCK_NAMES));

                // Populate data
                processDashboardData(data);
                hideFullPageLoading();
            })
            .catch(error => {
                console.error("Reset error:", error);
                hideFullPageLoading();
                alert("Reset failed: " + error.message);
            });
    });

    // Initial load
    updateDashboard(true); // pass true for initial page load
});

/**
 * Renders checkboxes inside sidebar dynamically
 */
function renderStockCheckboxes(stocks, checkedStates = {}) {
    const container = document.querySelector("#stockSelectionGroup > div");
    if (!container) return;
    container.innerHTML = "";

    stocks.forEach(ticker => {
        const label = document.createElement("label");
        label.style.display = "flex";
        label.style.alignItems = "center";
        label.style.gap = "0.5rem";
        label.style.cursor = "pointer";

        const isChecked = checkedStates[ticker] !== false;

        const input = document.createElement("input");
        input.type = "checkbox";
        input.className = "stock-chk";
        input.value = ticker;
        input.checked = isChecked;

        input.addEventListener("change", () => {
            const checkedCount = document.querySelectorAll(".stock-chk:checked").length;
            if (checkedCount === 0) {
                input.checked = true;
                alert("At least one asset must be selected for analysis.");
                return;
            }
            updateDashboard();
        });

        const name = PRESET_STOCK_NAMES[ticker] || ticker;
        label.appendChild(input);
        label.appendChild(document.createTextNode(` ${name}`));
        container.appendChild(label);
    });
}

/**
 * Debounce function to limit query spam
 */
function debouncedUpdate() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(updateDashboard, 250);
}

/**
 * Returns a list of checked stock values
 */
function getSelectedStocks() {
    const chks = document.querySelectorAll(".stock-chk");
    const selected = [];
    chks.forEach(chk => {
        if (chk.checked) {
            selected.push(chk.value);
        }
    });
    return selected.join(",");
}

/**
 * Get color for a specific regime index
 */
function getRegimeColor(c, k) {
    if (c === 0) return '#ef4444'; // Bear is always Red
    if (c === k - 1) return '#22c55e'; // Bull is always Green
    if (k === 3 && c === 1) return '#f59e0b'; // Sideways is Amber

    // Smooth gradient color mapping for other K levels
    const midColors = ['#f59e0b', '#3b82f6', '#8b5cf6', '#06b6d4', '#ec4899', '#eab308'];
    return midColors[(c - 1) % midColors.length];
}

/**
 * Get human-readable regime state label
 */
function getRegimeName(c, k) {
    if (c === 0) return 'Bear Market';
    if (c === k - 1) return 'Bull Market';
    if (k === 3 && c === 1) return 'Sideways Market';
    return `Regime ${c}`;
}

/**
 * Dynamic dashboard refresh function
 */
function updateDashboard(isInitial = false) {
    const k = document.getElementById("kNum").value;
    const vol_win = document.getElementById("volWin").value;
    const ret_win = document.getElementById("retWin").value;
    const mom_win = document.getElementById("momWin").value;
    const rsi_win = document.getElementById("rsiWin").value;
    const stocks = getSelectedStocks();

    const contentArea = document.querySelector(".content-area");
    if (contentArea && !isInitial) {
        contentArea.style.opacity = "0.5";
    }

    const url = `/api/data?k=${k}&vol_win=${vol_win}&ret_win=${ret_win}&mom_win=${mom_win}&rsi_win=${rsi_win}&stocks=${stocks}`;

    fetch(url)
        .then(response => {
            if (!response.ok) {
                return response.json().then(err => { throw new Error(err.error || "Quant calculation error") });
            }
            return response.json();
        })
        .then(data => {
            processDashboardData(data);
            if (contentArea) contentArea.style.opacity = "1.0";

            if (isInitial) {
                // Fade out initial loading overlay
                hideFullPageLoading();
                initScrollAnimations();
            }
        })
        .catch(error => {
            console.error("Dashboard update failed:", error);
            if (contentArea) contentArea.style.opacity = "1.0";
            hideFullPageLoading();
            alert("Error running regime model: " + error.message);
        });
}

/**
 * Processes incoming JSON data and refreshes all UI elements
 */
function processDashboardData(data) {
    if (data.error) {
        alert("Server calculation error: " + data.error);
        return;
    }

    // 1. Populate KPI Strip metrics
    document.getElementById("kpi-days").textContent = data.metrics.total_days.toLocaleString();
    
    const k = parseInt(document.getElementById("kNum").value);
    document.getElementById("silhouetteLabel").textContent = `Silhouette Score (K=${k})`;
    document.getElementById("kpi-silhouette").textContent = data.metrics.silhouette.toFixed(3);
    document.getElementById("kpi-pc1").textContent = data.metrics.pc1_pct.toFixed(1) + "%";
    document.getElementById("kpi-pccum").textContent = data.metrics.pc_cum_pct.toFixed(1) + "%";

    // 2. Update Dynamic Stock Badges
    const badgesContainer = document.getElementById("tickerBadges");
    if (badgesContainer) {
        badgesContainer.innerHTML = "";
        Object.keys(data.stock_data).forEach((ticker, index) => {
            const badge = document.createElement("span");
            badge.className = "ticker-badge";
            badge.setAttribute("data-ticker", ticker);
            const name = data.correlation_matrix.labels[index] || ticker;
            badge.textContent = `${name} (${ticker})`;
            badgesContainer.appendChild(badge);
        });
    }

    // 3. Dynamic Title configurations based on data active presets/custom
    const isCustom = document.getElementById("dataModeBadge").textContent.includes("Custom");
    document.getElementById("priceChartTitle").textContent = isCustom
        ? "Custom Index Close Price Overlayed with Composite Market Regimes"
        : "Nifty 50 Index Close Price Overlayed with Composite Market Regimes";

    document.getElementById("comparisonChartTitle").textContent = isCustom
        ? "Custom Asset Portfolio Normalized to 100 at Start Date"
        : "Blue-Chip Stock Portfolio Normalized to 100 at Start Date";

    // 4. Render and update the components
    renderPriceChart(data.price_data, k);
    renderStockComparisonChart(data.price_data, data.stock_data, data.correlation_matrix.labels);
    drawCorrelationHeatmap(data.correlation_matrix);
    renderElbowAndSilhouette(data.elbow_data, k);
    renderPCACharts(data.pca_data, data.pca_var, k);
    renderBreakdown(data.summary_data, k);
}

/**
 * Full page loading screen utilities
 */
function showFullPageLoading(text) {
    const loader = document.getElementById("loadingScreen");
    if (loader) {
        const loadingText = loader.querySelector(".loading-text");
        if (loadingText) loadingText.textContent = text;
        loader.classList.remove("fade-out");
    }
}

function hideFullPageLoading() {
    const loader = document.getElementById("loadingScreen");
    if (loader) {
        loader.classList.add("fade-out");
    }
}

/**
 * 1. Price Timeline Regime Colored Line Chart
 */
function renderPriceChart(priceData, k) {
    const dates = priceData.map(d => d.date);
    const prices = priceData.map(d => d.price);
    const regimes = priceData.map(d => d.regime);

    const datasets = [];
    for (let c = 0; c < k; c++) {
        const regimePrices = [];
        for (let i = 0; i < prices.length; i++) {
            const r = regimes[i];
            const p = prices[i];
            if (r === c || (i > 0 && regimes[i - 1] === c)) {
                regimePrices.push(p);
            } else {
                regimePrices.push(null);
            }
        }

        datasets.push({
            label: getRegimeName(c, k),
            data: regimePrices,
            borderColor: getRegimeColor(c, k),
            borderWidth: 2,
            pointRadius: 0,
            spanGaps: false,
            fill: false
        });
    }

    const ctx = document.getElementById("priceChart").getContext("2d");
    if (priceChartInst) {
        priceChartInst.destroy();
    }
    priceChartInst = new Chart(ctx, {
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
 * 2. Multi-line stock comparison chart (Normalized to 100)
 */
function renderStockComparisonChart(priceData, stockData, labels) {
    const dates = priceData.map(d => d.date);
    const colors = [
        '#3b82f6', '#10b981', '#ef4444', '#f59e0b',
        '#8b5cf6', '#ec4899', '#06b6d4', '#e2e8f0',
        '#f43f5e', '#10b981', '#84cc16'
    ];

    const datasets = Object.keys(stockData).map((ticker, index) => {
        const prices = stockData[ticker];
        const startPrice = prices[0];
        const normalizedPrices = prices.map(p => startPrice === 0 ? 0 : (p / startPrice) * 100);
        const color = colors[index % colors.length];
        const label = labels[index] || ticker;

        return {
            label: label,
            data: normalizedPrices,
            borderColor: color,
            borderWidth: 1.8,
            pointRadius: 0,
            fill: false,
            tension: 0.05
        };
    });

    const ctx = document.getElementById("stockComparisonChart").getContext("2d");
    if (stockComparisonChartInst) {
        stockComparisonChartInst.destroy();
    }
    stockComparisonChartInst = new Chart(ctx, {
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
 * 3. Pairwise Asset Correlation Heatmap drawn on HTML5 Canvas
 */
function drawCorrelationHeatmap(correlationData) {
    const canvas = document.getElementById("heatmapCanvas");
    if (!canvas) return;
    const ctx = canvas.getContext("2d");

    const matrix = correlationData.matrix;
    const labels = correlationData.labels;
    const n = matrix.length;

    const width = canvas.width;
    const height = canvas.height;
    const paddingLeft = 85;
    const paddingTop = 35;
    const paddingRight = 35;
    const paddingBottom = 85;

    const plotWidth = width - paddingLeft - paddingRight;
    const plotHeight = height - paddingTop - paddingBottom;
    const cellSize = plotWidth / n;

    ctx.clearRect(0, 0, width, height);

    function getColor(v) {
        let r, g, b;
        if (v >= 0) {
            r = Math.round(30 + v * (239 - 30));
            g = Math.round(41 + v * (68 - 41));
            b = Math.round(59 + v * (68 - 59));
        } else {
            const absV = Math.abs(v);
            r = Math.round(30 + absV * (59 - 30));
            g = Math.round(41 + absV * (130 - 41));
            b = Math.round(59 + absV * (246 - 59));
        }
        return `rgb(${r}, ${g}, ${b})`;
    }

    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = "bold 9px 'DM Mono', monospace";

    for (let i = 0; i < n; i++) {
        for (let j = 0; j < n; j++) {
            const val = matrix[i][j];
            const cellX = paddingLeft + j * cellSize;
            const cellY = paddingTop + i * cellSize;

            ctx.fillStyle = getColor(val);
            ctx.fillRect(cellX, cellY, cellSize - 1, cellSize - 1);

            ctx.fillStyle = "#ffffff";
            ctx.fillText(val.toFixed(2), cellX + cellSize / 2, cellY + cellSize / 2);
        }
    }

    ctx.fillStyle = "#94a3b8";
    ctx.font = "500 10px 'Outfit', sans-serif";

    ctx.textAlign = "right";
    for (let i = 0; i < n; i++) {
        const labelY = paddingTop + i * cellSize + cellSize / 2;
        ctx.fillText(labels[i], paddingLeft - 10, labelY);
    }

    ctx.textAlign = "left";
    for (let j = 0; j < n; j++) {
        const labelX = paddingLeft + j * cellSize + cellSize / 2;
        ctx.save();
        ctx.translate(labelX, height - paddingBottom + 10);
        ctx.rotate(Math.PI / 4);
        ctx.fillText(labels[j], 0, 0);
        ctx.restore();
    }
}

/**
 * 4. Elbow & Silhouette Cluster Optimization Charts
 */
function renderElbowAndSilhouette(elbowData, currentK) {
    const kVals = elbowData.map(d => d.k);
    const inertias = elbowData.map(d => d.inertia);
    const silhouettes = elbowData.map(d => d.silhouette);

    const ctxElbow = document.getElementById("elbowChart").getContext("2d");
    if (elbowChartInst) elbowChartInst.destroy();
    elbowChartInst = new Chart(ctxElbow, {
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
                pointBackgroundColor: kVals.map(k => k === currentK ? '#22c55e' : '#3b82f6'),
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

    const ctxSil = document.getElementById("silhouetteChart").getContext("2d");
    if (silhouetteChartInst) silhouetteChartInst.destroy();
    silhouetteChartInst = new Chart(ctxSil, {
        type: 'bar',
        data: {
            labels: kVals,
            datasets: [{
                label: 'Silhouette Score',
                data: silhouettes,
                backgroundColor: kVals.map(k => k === currentK ? '#22c55e' : 'rgba(59, 130, 246, 0.3)'),
                borderColor: kVals.map(k => k === currentK ? '#22c55e' : '#3b82f6'),
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
 * 5. PCA Projection Scatter and Variance Explained Combo Chart
 */
function renderPCACharts(pcaData, pcaVar, k) {
    const groups = {};
    for (let c = 0; c < k; c++) {
        groups[c] = [];
    }

    pcaData.forEach(pt => {
        const pObj = { x: pt.pc1, y: pt.pc2 };
        if (groups[pt.regime] !== undefined) {
            groups[pt.regime].push(pObj);
        }
    });

    const datasets = [];
    for (let c = 0; c < k; c++) {
        datasets.push({
            label: getRegimeName(c, k) + ' Cluster',
            data: groups[c],
            backgroundColor: getRegimeColor(c, k),
            pointRadius: 4
        });
    }

    const ctxScatter = document.getElementById("pcaScatterChart").getContext("2d");
    if (pcaScatterChartInst) pcaScatterChartInst.destroy();
    pcaScatterChartInst = new Chart(ctxScatter, {
        type: 'scatter',
        data: {
            datasets: datasets
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

    const pcLabels = ['PC1', 'PC2', 'PC3', 'PC4', 'PC5', 'PC6'];
    const indVars = pcaVar.map(v => v * 100);
    const cumVars = [];
    let cumulative = 0;
    indVars.forEach(v => {
        cumulative += v;
        cumVars.push(cumulative);
    });

    const ctxVariance = document.getElementById("pcaVarianceChart").getContext("2d");
    if (pcaVarianceChartInst) pcaVarianceChartInst.destroy();
    pcaVarianceChartInst = new Chart(ctxVariance, {
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
                    yAxisID: 'y',
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
                    yAxisID: 'y1'
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
                y: {
                    type: 'linear',
                    position: 'left',
                    title: { display: true, text: 'Individual Variance (%)', color: '#94a3b8', font: { family: 'Outfit' } },
                    grid: { color: 'rgba(255, 255, 255, 0.03)' },
                    ticks: { color: '#94a3b8' }
                },
                y1: {
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
 * 6. Regime Shares Doughnut and Performance Summary Profile Table
 */
function renderBreakdown(summaryData, k) {
    const labels = summaryData.map(row => `${row.name} Regime`);
    const data = summaryData.map(row => row.pct);
    const backgroundColors = summaryData.map(row => getRegimeColor(row.regime, k));

    const ctxPie = document.getElementById("doughnutChart").getContext("2d");
    if (doughnutChartInst) doughnutChartInst.destroy();
    doughnutChartInst = new Chart(ctxPie, {
        type: 'doughnut',
        data: {
            labels: labels,
            datasets: [{
                data: data,
                backgroundColor: backgroundColors,
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

    const tbody = document.getElementById("summaryTable").querySelector("tbody");
    tbody.innerHTML = "";

    summaryData.forEach(row => {
        const tr = document.createElement("tr");
        let badgeClass = "pill ";
        if (row.regime === 0) badgeClass += "bear";
        else if (row.regime === k - 1) badgeClass += "bull";
        else badgeClass += "sideways";

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
 * IntersectionObserver Scroll Animation setup
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

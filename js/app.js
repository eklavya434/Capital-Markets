/**
 * app.js - UI coordination, CSV parsing, Chart.js management, and SVG Dendrogram rendering.
 */

// Global App State
let currentRawData = []; // Array of { date, close }
let activeDatasetName = "SPY";
let priceChartInstance = null;
let pcaChartInstance = null;

// DOM Elements
const datasetSelect = document.getElementById("datasetSelect");
const csvUploadWrapper = document.getElementById("csvUploadWrapper");
const csvFileInput = document.getElementById("csvFileInput");
const dataStatusBadge = document.getElementById("dataStatusBadge");
const loadingOverlay = document.getElementById("loadingOverlay");

const returnWindowInput = document.getElementById("returnWindow");
const returnWindowVal = document.getElementById("returnWindowVal");
const volWindowInput = document.getElementById("volWindow");
const volWindowVal = document.getElementById("volWindowVal");
const drawdownWindowInput = document.getElementById("drawdownWindow");
const drawdownWindowVal = document.getElementById("drawdownWindowVal");

const clusterCountInput = document.getElementById("clusterCount");
const clusterCountVal = document.getElementById("clusterCountVal");
const linkageSelect = document.getElementById("linkageSelect");
const dendrogramLimitInput = document.getElementById("dendrogramLimit");
const dendrogramLimitVal = document.getElementById("dendrogramLimitVal");

const bullDaysPct = document.getElementById("bullDaysPct");
const bullMetricsText = document.getElementById("bullMetricsText");
const sidewaysDaysPct = document.getElementById("sidewaysDaysPct");
const sidewaysMetricsText = document.getElementById("sidewaysMetricsText");
const bearDaysPct = document.getElementById("bearDaysPct");
const bearMetricsText = document.getElementById("bearMetricsText");

const pcaLoadingsTable = document.getElementById("pcaLoadingsTable").querySelector("tbody");
const pc1VariancePct = document.getElementById("pc1VariancePct");
const pc2VariancePct = document.getElementById("pc2VariancePct");
const pcCumulativePct = document.getElementById("pcCumulativePct");

const regimeStatsTable = document.getElementById("regimeStatsTable").querySelector("tbody");
const copyCodeBtn = document.getElementById("copyCodeBtn");
const pythonCodeBlock = document.getElementById("pythonCodeBlock");

// Theme colors matching CSS
const COLORS = {
    bear: 'rgb(244, 63, 94)',      // #f43f5e
    bearGlow: 'rgba(244, 63, 94, 0.08)',
    sideways: 'rgb(245, 158, 11)',  // #f59e0b
    sidewaysGlow: 'rgba(245, 158, 11, 0.08)',
    bull: 'rgb(16, 185, 129)',     // #10b981
    bullGlow: 'rgba(16, 185, 129, 0.08)',
    gray: 'rgb(100, 116, 139)',
    grid: 'rgba(255, 255, 255, 0.05)',
    text: '#94a3b8'
};

// Initialize Dashboard
document.addEventListener("DOMContentLoaded", () => {
    // 1. Setup Tab Switching
    const tabs = document.querySelectorAll(".tab-btn");
    tabs.forEach(tab => {
        tab.addEventListener("click", () => {
            tabs.forEach(t => t.classList.remove("active"));
            document.querySelectorAll(".tab-panel").forEach(p => p.classList.remove("active"));
            
            tab.classList.add("active");
            const targetPanel = document.getElementById(tab.getAttribute("data-tab"));
            if (targetPanel) {
                targetPanel.classList.add("active");
            }
        });
    });

    // 2. Setup Slider Value Listeners
    setupSliderListener(returnWindowInput, returnWindowVal, "d");
    setupSliderListener(volWindowInput, volWindowVal, "d");
    setupSliderListener(drawdownWindowInput, drawdownWindowVal, "d");
    setupSliderListener(clusterCountInput, clusterCountVal, "");
    setupSliderListener(dendrogramLimitInput, dendrogramLimitVal, "d");

    // 3. Input change updates
    const inputsToTriggerUpdate = [
        returnWindowInput, volWindowInput, drawdownWindowInput,
        clusterCountInput, linkageSelect, dendrogramLimitInput
    ];
    inputsToTriggerUpdate.forEach(input => {
        input.addEventListener("input", debounce(runRegimeAnalysis, 250));
    });

    // 4. Data source selection listener
    datasetSelect.addEventListener("change", (e) => {
        const val = e.target.value;
        if (val === "CSV") {
            csvUploadWrapper.style.display = "flex";
        } else {
            csvUploadWrapper.style.display = "none";
            loadPreset(val);
        }
    });

    // 5. CSV File Uploader
    csvFileInput.addEventListener("change", handleCSVUpload);

    // 6. Copy code functionality
    copyCodeBtn.addEventListener("click", () => {
        navigator.clipboard.writeText(pythonCodeBlock.textContent)
            .then(() => {
                copyCodeBtn.textContent = "Copied!";
                setTimeout(() => copyCodeBtn.textContent = "Copy to Clipboard", 2000);
            })
            .catch(err => console.error("Could not copy text: ", err));
    });

    // Load Default Dataset (SPY)
    loadPreset("SPY");
});

// Helper: Bind slider visual value update
function setupSliderListener(slider, display, suffix) {
    slider.addEventListener("input", (e) => {
        display.textContent = e.target.value + suffix;
    });
}

// Helper: Debounce function for smooth UI interactions
function debounce(func, wait) {
    let timeout;
    return function(...args) {
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(this, args), wait);
    };
}

// Load Preset Data
function loadPreset(key) {
    showLoading(true);
    setTimeout(() => {
        if (PRESET_DATA && PRESET_DATA[key]) {
            currentRawData = PRESET_DATA[key];
            activeDatasetName = key;
            dataStatusBadge.textContent = `${key} Preset Active (${currentRawData.length} days)`;
            runRegimeAnalysis();
        } else {
            alert(`Preset ${key} data not found!`);
            showLoading(false);
        }
    }, 100);
}

// CSV Upload Handler
function handleCSVUpload(e) {
    const file = e.target.files[0];
    if (!file) return;

    showLoading(true);
    const reader = new FileReader();
    reader.onload = function(evt) {
        const text = evt.target.result;
        try {
            const parsed = parseCSV(text);
            if (parsed.length < 100) {
                throw new Error("Dataset is too small. Please upload at least 100 daily records.");
            }
            currentRawData = parsed;
            activeDatasetName = file.name.substring(0, 15);
            dataStatusBadge.textContent = `CSV: ${activeDatasetName} (${currentRawData.length} records)`;
            runRegimeAnalysis();
        } catch (err) {
            alert(`CSV Parsing Error: ${err.message}`);
            showLoading(false);
        }
    };
    reader.readAsText(file);
}

// Robust CSV Parser
function parseCSV(text) {
    const lines = text.split(/\r?\n/).map(line => line.trim()).filter(line => line.length > 0);
    if (lines.length < 2) throw new Error("File is empty or contains no headers.");

    // Header Detection
    const headers = lines[0].split(",").map(h => h.trim().toLowerCase());
    
    // Find Date Column
    const dateIdx = headers.findIndex(h => h.includes("date") || h.includes("time") || h.includes("timestamp"));
    // Find Close Column (fallbacks: price, close, adj close, value)
    const closeIdx = headers.findIndex(h => h.includes("close") || h.includes("price") || h.includes("value") || h.includes("val"));

    if (dateIdx === -1) throw new Error("Could not find a 'Date' column in headers.");
    if (closeIdx === -1) throw new Error("Could not find a 'Close' or 'Price' column in headers.");

    const records = [];
    for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].split(",");
        if (cols.length <= Math.max(dateIdx, closeIdx)) continue;

        const dateVal = cols[dateIdx].trim();
        const closeVal = parseFloat(cols[closeIdx].trim());

        if (dateVal && !isNaN(closeVal)) {
            records.push({ date: dateVal, close: closeVal });
        }
    }

    // Sort chronologically by date
    records.sort((a, b) => new Date(a.date) - new Date(b.date));
    return records;
}

// SHOW/HIDE Loading Spinner
function showLoading(show) {
    if (show) {
        loadingOverlay.classList.add("active");
    } else {
        loadingOverlay.classList.remove("active");
    }
}

// CORE PIPELINE RUNNER
function runRegimeAnalysis() {
    showLoading(true);
    
    // Defer processing to let the browser draw the spinner
    setTimeout(() => {
        try {
            if (currentRawData.length === 0) return;

            const prices = currentRawData.map(r => r.close);
            const dates = currentRawData.map(r => r.date);

            // Get parameters
            const rWindow = parseInt(returnWindowInput.value);
            const vWindow = parseInt(volWindowInput.value);
            const dWindow = parseInt(drawdownWindowInput.value);
            const k = parseInt(clusterCountInput.value);
            const linkage = linkageSelect.value;
            const dendrogramLimit = parseInt(dendrogramLimitInput.value);

            // 1. Calculate Indicators
            const dailyRets = Indicators.dailyReturns(prices);
            const rollReturns = Indicators.rollingReturns(prices, rWindow);
            const rollVols = Indicators.rollingVolatility(dailyRets, vWindow);
            const rollDDs = Indicators.rollingMaxDrawdown(prices, dWindow);

            // Determine offsets (start analysis only when all indicators have valid data)
            const offset = Math.max(rWindow, vWindow, dWindow);
            if (prices.length <= offset + 10) {
                throw new Error("Lookback windows are too large for this dataset. Decrease lookback windows.");
            }

            // Sliced datasets
            const datesSlice = dates.slice(offset);
            const pricesSlice = prices.slice(offset);
            const rollReturnsSlice = rollReturns.slice(offset);
            const rollVolsSlice = rollVols.slice(offset);
            const rollDDsSlice = rollDDs.slice(offset);

            // 2D Array of raw features of shape [N, 3]
            const rawFeatures = Array.from({ length: pricesSlice.length }, (_, i) => [
                rollReturnsSlice[i],
                rollVolsSlice[i],
                rollDDsSlice[i]
            ]);

            // 2. Standard Scale Features
            const scaler = new StandardScaler();
            const scaledFeatures = scaler.fitTransform(rawFeatures);

            // 3. Dimensionality Reduction (PCA)
            const pcaInstance = new PCA(2);
            const pcaProj = pcaInstance.fitTransform(scaledFeatures);

            // 4. Unsupervised K-Means Clustering
            const kmeansInstance = new KMeans(k);
            kmeansInstance.fit(scaledFeatures);

            // 5. Logical Regime Mapping
            // Profiles clusters. Map cluster output to logical Bear (0), Sideways (1), Bull (2)
            const logicalMapping = kmeansInstance.getLogicalRegimeMapping(rawFeatures);
            const mappedLabels = kmeansInstance.labels.map(l => logicalMapping[l]);

            // 6. Summarize statistics
            const stats = computeRegimeStats(mappedLabels, pricesSlice, rollReturnsSlice, rollVolsSlice, rollDDsSlice, k);

            // 7. Render Hierarchical Clustering on Recent Data
            const recentLimit = Math.min(dendrogramLimit, scaledFeatures.length);
            const recentScaled = scaledFeatures.slice(-recentLimit);
            const recentLabels = mappedLabels.slice(-recentLimit);
            
            const hc = new HierarchicalClustering(linkage);
            const hcTreeRoot = hc.fit(recentScaled);

            // 8. Update UI Components
            updateQuickMetricsUI(stats);
            renderPriceRegimeChart(datesSlice, pricesSlice, mappedLabels);
            renderPCAScatterChart(pcaProj, mappedLabels, k);
            updatePCALoadingsUI(pcaInstance);
            renderSVGDendrogram(hcTreeRoot, recentLimit, recentLabels);
            updateStatsTableUI(stats);

        } catch (err) {
            console.error(err);
            alert(`Error running analysis: ${err.message}`);
        } finally {
            showLoading(false);
        }
    }, 50);
}

// Compute statistics for each regime
function computeRegimeStats(labels, prices, returns, vols, drawdowns, k) {
    const n = labels.length;
    const stats = Array.from({ length: k }, (_, i) => ({
        id: i,
        name: i === 0 ? "Bear" : (i === 1 && k === 3 ? "Sideways" : (i === k - 1 ? "Bull" : `Regime ${i}`)),
        class: i === 0 ? "bear" : (i === 1 && k === 3 ? "sideways" : (i === k - 1 ? "bull" : "gray")),
        count: 0,
        daysPct: 0,
        avgReturn: 0,
        annVol: 0,
        maxDD: 0
    }));

    // Daily returns for volatility calculations per regime
    const regimeDailyReturns = Array.from({ length: k }, () => []);

    for (let i = 0; i < n; i++) {
        const rLabel = labels[i];
        const stat = stats[rLabel];
        if (!stat) continue;

        stat.count++;
        stat.avgReturn += returns[i];
        stat.maxDD = Math.max(stat.maxDD, drawdowns[i]);
        
        // Save daily returns (to compute annualized volatility for the regime)
        // Approximate daily returns from returns slice (since daily return = returns[i]/window)
        // To be precise, we use the actual daily return of that day:
        // We find the index in original dataset: index = offset + i
        const origIdx = currentRawData.length - n + i;
        if (origIdx > 0) {
            const prevPrice = currentRawData[origIdx - 1].close;
            const curPrice = currentRawData[origIdx].close;
            const dRet = prevPrice === 0 ? 0 : (curPrice - prevPrice) / prevPrice;
            regimeDailyReturns[rLabel].push(dRet);
        }
    }

    // Compute averages and annualized vols
    stats.forEach((stat, rLabel) => {
        if (stat.count > 0) {
            stat.daysPct = (stat.count / n) * 100;
            stat.avgReturn = (stat.avgReturn / stat.count) * 100; // In %

            // Annualized volatility = Std(daily returns) * sqrt(252)
            const rRets = regimeDailyReturns[rLabel];
            if (rRets.length > 1) {
                const mean = rRets.reduce((s, val) => s + val, 0) / rRets.length;
                const variance = rRets.reduce((s, val) => s + Math.pow(val - mean, 2), 0) / (rRets.length - 1);
                const dailyVol = Math.sqrt(variance);
                stat.annVol = dailyVol * Math.sqrt(252) * 100; // Annualized Vol in %
            } else {
                stat.annVol = 0;
            }
        }
    });

    return stats;
}

// Update Top Analytics Widgets
function updateQuickMetricsUI(stats) {
    // Reset displays
    bullDaysPct.textContent = "0.0%";
    bullMetricsText.textContent = "Avg Return: -- | Vol: --";
    sidewaysDaysPct.textContent = "0.0%";
    sidewaysMetricsText.textContent = "Avg Return: -- | Vol: --";
    bearDaysPct.textContent = "0.0%";
    bearMetricsText.textContent = "Avg Return: -- | Vol: --";

    stats.forEach(stat => {
        const pctStr = `${stat.daysPct.toFixed(1)}%`;
        const metricsStr = `Avg Ret: ${stat.avgReturn.toFixed(2)}% | Ann Vol: ${stat.annVol.toFixed(1)}%`;
        
        if (stat.class === "bull") {
            bullDaysPct.textContent = pctStr;
            bullMetricsText.textContent = metricsStr;
        } else if (stat.class === "sideways") {
            sidewaysDaysPct.textContent = pctStr;
            sidewaysMetricsText.textContent = metricsStr;
        } else if (stat.class === "bear") {
            bearDaysPct.textContent = pctStr;
            bearMetricsText.textContent = metricsStr;
        }
    });
}

// Update PCA Table and Variance Displays
function updatePCALoadingsUI(pca) {
    pcaLoadingsTable.innerHTML = "";
    
    const features = ["Rolling Return", "Rolling Volatility", "Rolling Max Drawdown"];
    for (let i = 0; i < features.length; i++) {
        const row = document.createElement("tr");
        row.innerHTML = `
            <td><b>${features[i]}</b></td>
            <td style="font-family: 'JetBrains Mono', monospace; color: ${pca.eigenvectors[i][0] >= 0 ? '#10b981' : '#f43f5e'}">
                ${pca.eigenvectors[i][0].toFixed(3)}
            </td>
            <td style="font-family: 'JetBrains Mono', monospace; color: ${pca.eigenvectors[i][1] >= 0 ? '#10b981' : '#f43f5e'}">
                ${pca.eigenvectors[i][1].toFixed(3)}
            </td>
        `;
        pcaLoadingsTable.appendChild(row);
    }

    const pc1Var = pca.explainedVarianceRatio[0] * 100;
    const pc2Var = pca.explainedVarianceRatio[1] * 100;
    const cumVar = pc1Var + pc2Var;

    pc1VariancePct.textContent = `${pc1Var.toFixed(1)}%`;
    pc2VariancePct.textContent = `${pc2Var.toFixed(1)}%`;
    pcCumulativePct.textContent = `${cumVar.toFixed(1)}%`;
}

// Update Stats Table tab
function updateStatsTableUI(stats) {
    regimeStatsTable.innerHTML = "";
    stats.forEach(stat => {
        const row = document.createElement("tr");
        row.innerHTML = `
            <td><span class="badge ${stat.class}">${stat.name}</span></td>
            <td>${stat.count}</td>
            <td style="font-family: 'JetBrains Mono', monospace;">${stat.daysPct.toFixed(1)}%</td>
            <td style="font-family: 'JetBrains Mono', monospace; color: ${stat.avgReturn >= 0 ? '#10b981' : '#f43f5e'}">
                ${stat.avgReturn >= 0 ? '+' : ''}${stat.avgReturn.toFixed(3)}%
            </td>
            <td style="font-family: 'JetBrains Mono', monospace;">${stat.annVol.toFixed(1)}%</td>
            <td style="font-family: 'JetBrains Mono', monospace; color: var(--regime-bear);">${(stat.maxDD * 100).toFixed(1)}%</td>
        `;
        regimeStatsTable.appendChild(row);
    });
}

// Render Main Line Price Chart with Segment & Background Colors
function renderPriceRegimeChart(dates, prices, labels) {
    if (priceChartInstance) {
        priceChartInstance.destroy();
    }

    const ctx = document.getElementById("priceRegimeChart").getContext("2d");

    // Plugin for Vertical Colored Background Stripes
    const regimeBackgroundsPlugin = {
        id: 'regimeBackgrounds',
        beforeDraw: (chart) => {
            const ctx = chart.ctx;
            const xAxis = chart.scales.x;
            const yAxis = chart.scales.y;
            if (!xAxis || !yAxis) return;

            const count = labels.length;
            const chartWidth = xAxis.width;
            const stepWidth = chartWidth / (count - 1 || 1);

            ctx.save();
            for (let i = 0; i < count; i++) {
                const label = labels[i];
                const xVal = xAxis.getPixelForTick(i);
                const startX = xVal - stepWidth / 2;
                const endX = xVal + stepWidth / 2;

                let fill = 'rgba(0, 0, 0, 0)';
                if (label === 0) fill = COLORS.bearGlow;
                else if (label === 1) fill = COLORS.sidewaysGlow;
                else if (label === 2) fill = COLORS.bullGlow;

                ctx.fillStyle = fill;
                ctx.fillRect(startX, yAxis.top, endX - startX, yAxis.bottom - yAxis.top);
            }
            ctx.restore();
        }
    };

    priceChartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            labels: dates,
            datasets: [{
                label: `${activeDatasetName} Close Price`,
                data: prices,
                pointRadius: 0,
                borderWidth: 2.5,
                // Segment borders dynamically using CSS regime variables
                segment: {
                    borderColor: (ctx) => {
                        const idx = ctx.p1DataIndex;
                        const label = labels[idx];
                        if (label === 0) return COLORS.bear;
                        if (label === 1) return COLORS.sideways;
                        if (label === 2) return COLORS.bull;
                        return COLORS.gray;
                    }
                }
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                x: {
                    grid: { color: COLORS.grid },
                    ticks: {
                        color: COLORS.text,
                        maxTicksLimit: 12,
                        font: { family: 'Outfit' }
                    }
                },
                y: {
                    grid: { color: COLORS.grid },
                    ticks: {
                        color: COLORS.text,
                        font: { family: 'Outfit' }
                    }
                }
            },
            plugins: {
                legend: {
                    display: false
                },
                tooltip: {
                    mode: 'index',
                    intersect: false,
                    titleFont: { family: 'Outfit', size: 13 },
                    bodyFont: { family: 'Outfit', size: 12 },
                    backgroundColor: 'rgba(9, 13, 22, 0.95)',
                    borderColor: 'rgba(255, 255, 255, 0.1)',
                    borderWidth: 1,
                    callbacks: {
                        label: function(context) {
                            const idx = context.dataIndex;
                            const price = context.parsed.y.toFixed(2);
                            const label = labels[idx];
                            let name = "Unknown";
                            if (label === 0) name = "Bear";
                            else if (label === 1) name = "Sideways";
                            else if (label === 2) name = "Bull";
                            return `Price: $${price} | Regime: ${name}`;
                        }
                    }
                }
            }
        },
        plugins: [regimeBackgroundsPlugin]
    });
}

// Render 2D PCA Scatter plot
function renderPCAScatterChart(pcaProj, labels, k) {
    if (pcaChartInstance) {
        pcaChartInstance.destroy();
    }

    const ctx = document.getElementById("pcaScatterChart").getContext("2d");

    // Group PCA projection coordinates by labels
    const groups = Array.from({ length: k }, () => []);
    for (let i = 0; i < pcaProj.length; i++) {
        const label = labels[i];
        groups[label].push({ x: pcaProj[i][0], y: pcaProj[i][1] });
    }

    // Prepare datasets
    const datasets = [];
    const regimeNames = {
        0: { name: "Bear Regime", color: COLORS.bear },
        1: { name: k === 3 ? "Sideways Regime" : "Regime 1", color: COLORS.sideways },
        2: { name: k === 3 ? "Bull Regime" : "Regime 2", color: COLORS.bull },
        3: { name: "Regime 3", color: COLORS.gray }
    };

    for (let c = 0; c < k; c++) {
        const profile = regimeNames[c] || { name: `Regime ${c}`, color: COLORS.gray };
        datasets.push({
            label: profile.name,
            data: groups[c],
            backgroundColor: profile.color,
            pointRadius: 4,
            pointHoverRadius: 6,
            borderWidth: 0
        });
    }

    pcaChartInstance = new Chart(ctx, {
        type: 'scatter',
        data: { datasets },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                x: {
                    title: {
                        display: true,
                        text: 'Principal Component 1 (PC1)',
                        color: COLORS.text,
                        font: { family: 'Outfit', size: 12 }
                    },
                    grid: { color: COLORS.grid },
                    ticks: { color: COLORS.text, font: { family: 'Outfit' } }
                },
                y: {
                    title: {
                        display: true,
                        text: 'Principal Component 2 (PC2)',
                        color: COLORS.text,
                        font: { family: 'Outfit', size: 12 }
                    },
                    grid: { color: COLORS.grid },
                    ticks: { color: COLORS.text, font: { family: 'Outfit' } }
                }
            },
            plugins: {
                legend: {
                    position: 'top',
                    labels: {
                        color: varColor('--text-primary'),
                        font: { family: 'Outfit', size: 11 },
                        usePointStyle: true
                    }
                },
                tooltip: {
                    titleFont: { family: 'Outfit' },
                    bodyFont: { family: 'Outfit' },
                    backgroundColor: 'rgba(9, 13, 22, 0.95)',
                    borderColor: 'rgba(255, 255, 255, 0.1)',
                    borderWidth: 1
                }
            }
        }
    });
}

function varColor(variableName) {
    return getComputedStyle(document.documentElement).getPropertyValue(variableName).trim();
}

// Render SVG Dendrogram
function renderSVGDendrogram(root, totalRecentDays, recentLabels) {
    const svg = document.getElementById("dendrogramSvg");
    svg.innerHTML = ""; // Clear SVG

    if (!root) return;

    const svgWidth = 800;
    const svgHeight = 400;
    const padding = 35;

    document.getElementById("dendrogramSpan").textContent = `Clustered last ${totalRecentDays} days`;

    // 1. Traverse and extract leaf ordering to prevent line crossings
    function getLeafOrder(node) {
        if (!node.left && !node.right) {
            return [node.id];
        }
        return [...getLeafOrder(node.left), ...getLeafOrder(node.right)];
    }

    const leafOrder = getLeafOrder(root);
    const leafIndexMap = {};
    leafOrder.forEach((id, index) => {
        leafIndexMap[id] = index;
    });

    // 2. Recursively calculate node coordinates
    const maxTreeHeight = root.height;
    function computeCoords(node) {
        const w = svgWidth - 2 * padding;
        const h = svgHeight - 2 * padding - 20; // Extra room for labels at the bottom

        if (!node.left && !node.right) {
            // Leaf: evenly distributed along bottom
            node.x = padding + leafIndexMap[node.id] * (w / (leafOrder.length - 1 || 1));
            node.y = svgHeight - padding - 15;
            return;
        }

        computeCoords(node.left);
        computeCoords(node.right);

        // Parent is centered above its children
        node.x = (node.left.x + node.right.x) / 2;
        
        // Height is scaled to fit SVG
        const pct = node.height / (maxTreeHeight || 1);
        node.y = (svgHeight - padding - 15) - pct * h;
    }

    computeCoords(root);

    // 3. Draw connection lines (links)
    const gLinks = document.createElementNS("http://www.w3.org/2000/svg", "g");
    
    function drawNodeLinks(node) {
        if (!node.left && !node.right) return;

        // Orthogonal connecting lines
        // 1. Line from left child straight up to parent's y level
        const lineLeft = document.createElementNS("http://www.w3.org/2000/svg", "path");
        const pathLeft = `M ${node.left.x} ${node.left.y} L ${node.left.x} ${node.y} L ${node.x} ${node.y}`;
        lineLeft.setAttribute("d", pathLeft);
        lineLeft.setAttribute("class", "dendrogram-link");
        
        // Color based on regime if all points in the child are in the same regime
        const leftRegime = getSubtreeRegime(node.left, recentLabels);
        lineLeft.setAttribute("stroke", leftRegime === 0 ? COLORS.bear : (leftRegime === 1 ? COLORS.sideways : (leftRegime === 2 ? COLORS.bull : COLORS.gray)));
        if (leftRegime !== -1) {
            lineLeft.setAttribute("stroke-width", "2");
        }
        gLinks.appendChild(lineLeft);

        // 2. Line from right child straight up to parent's y level
        const lineRight = document.createElementNS("http://www.w3.org/2000/svg", "path");
        const pathRight = `M ${node.right.x} ${node.right.y} L ${node.right.x} ${node.y} L ${node.x} ${node.y}`;
        lineRight.setAttribute("d", pathRight);
        lineRight.setAttribute("class", "dendrogram-link");
        
        const rightRegime = getSubtreeRegime(node.right, recentLabels);
        lineRight.setAttribute("stroke", rightRegime === 0 ? COLORS.bear : (rightRegime === 1 ? COLORS.sideways : (rightRegime === 2 ? COLORS.bull : COLORS.gray)));
        if (rightRegime !== -1) {
            lineRight.setAttribute("stroke-width", "2");
        }
        gLinks.appendChild(lineRight);

        drawNodeLinks(node.left);
        drawNodeLinks(node.right);
    }

    drawNodeLinks(root);
    svg.appendChild(gLinks);

    // Helper: Determine if all points in subtree belong to a single regime
    function getSubtreeRegime(node, labels) {
        const subtreePoints = node.points;
        if (subtreePoints.length === 0) return -1;
        
        const firstLabel = labels[subtreePoints[0]];
        for (let i = 1; i < subtreePoints.length; i++) {
            if (labels[subtreePoints[i]] !== firstLabel) {
                return -1; // Mixed regime
            }
        }
        return firstLabel;
    }

    // 4. Draw leaf nodes / labels (only if totalRecentDays is small, otherwise show ticks)
    const gNodes = document.createElementNS("http://www.w3.org/2000/svg", "g");
    const labelStep = Math.max(1, Math.floor(totalRecentDays / 40)); // Throttle date labels if crowded

    leafOrder.forEach((id, idx) => {
        const x = padding + idx * ((svgWidth - 2 * padding) / (leafOrder.length - 1 || 1));
        const y = svgHeight - padding - 15;
        const regime = recentLabels[id];

        // Draw small dot for each day
        const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
        circle.setAttribute("cx", x);
        circle.setAttribute("cy", y);
        circle.setAttribute("r", "2.5");
        circle.setAttribute("fill", regime === 0 ? COLORS.bear : (regime === 1 ? COLORS.sideways : (regime === 2 ? COLORS.bull : COLORS.gray)));
        gNodes.appendChild(circle);

        // Render date labels (throttled)
        if (idx % labelStep === 0) {
            const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
            // Pull actual date
            const recordIdx = currentRawData.length - totalRecentDays + id;
            const dateStr = currentRawData[recordIdx] ? currentRawData[recordIdx].date.substring(5) : ""; // MM-DD
            
            text.setAttribute("x", x);
            text.setAttribute("y", y + 15);
            text.setAttribute("text-anchor", "middle");
            text.setAttribute("transform", `rotate(45, ${x}, ${y + 15})`);
            text.setAttribute("fill", COLORS.text);
            text.style.fontSize = "7px";
            text.style.fontFamily = "JetBrains Mono, monospace";
            text.textContent = dateStr;
            gNodes.appendChild(text);
        }
    });

    svg.appendChild(gNodes);
}

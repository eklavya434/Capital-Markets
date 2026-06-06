/**
 * mathematical engine for Equity Market Regime Analysis
 * Pure JS implementations of feature extraction, standard scaling, PCA, K-Means, and Hierarchical Clustering.
 */

// 1. INDICATORS GENERATOR
class Indicators {
    /**
     * Calculate daily returns from prices
     * @param {number[]} prices
     * @returns {number[]}
     */
    static dailyReturns(prices) {
        const returns = [0]; // First day return is 0
        for (let i = 1; i < prices.length; i++) {
            const prev = prices[i - 1];
            returns.push(prev === 0 ? 0 : (prices[i] - prev) / prev);
        }
        return returns;
    }

    /**
     * Calculate rolling standard deviation (volatility) of returns
     * @param {number[]} returns
     * @param {number} window
     * @returns {number[]}
     */
    static rollingVolatility(returns, window) {
        const vol = new Array(returns.length).fill(0);
        for (let i = 0; i < returns.length; i++) {
            if (i < window - 1) {
                vol[i] = 0; // Not enough data
                continue;
            }
            // Calculate mean
            let sum = 0;
            for (let j = 0; j < window; j++) {
                sum += returns[i - j];
            }
            const mean = sum / window;
            
            // Calculate variance
            let varianceSum = 0;
            for (let j = 0; j < window; j++) {
                varianceSum += Math.pow(returns[i - j] - mean, 2);
            }
            vol[i] = Math.sqrt(varianceSum / (window - 1)); // Sample standard deviation
        }
        return vol;
    }

    /**
     * Calculate rolling returns over a window
     * @param {number[]} prices
     * @param {number} window
     * @returns {number[]}
     */
    static rollingReturns(prices, window) {
        const rollRet = new Array(prices.length).fill(0);
        for (let i = 0; i < prices.length; i++) {
            if (i < window) {
                rollRet[i] = 0;
                continue;
            }
            const startPrice = prices[i - window];
            rollRet[i] = startPrice === 0 ? 0 : (prices[i] - startPrice) / startPrice;
        }
        return rollRet;
    }

    /**
     * Calculate rolling drawdown
     * @param {number[]} prices
     * @param {number} window
     * @returns {number[]}
     */
    static rollingMaxDrawdown(prices, window) {
        const drawdown = new Array(prices.length).fill(0);
        for (let i = 0; i < prices.length; i++) {
            if (i < window - 1) {
                drawdown[i] = 0;
                continue;
            }
            // Find max price in the window
            let maxPrice = prices[i];
            let maxDraw = 0;
            for (let j = 0; j < window; j++) {
                const p = prices[i - j];
                if (p > maxPrice) {
                    maxPrice = p;
                }
                const draw = maxPrice === 0 ? 0 : (maxPrice - p) / maxPrice;
                if (draw > maxDraw) {
                    maxDraw = draw;
                }
            }
            drawdown[i] = maxDraw;
        }
        return drawdown;
    }
}

// 2. STANDARD SCALER
class StandardScaler {
    constructor() {
        this.means = [];
        this.stds = [];
    }

    /**
     * Fit the scaler to data (calculate mean & std)
     * @param {number[][]} data - 2D matrix of shape [N, M]
     */
    fit(data) {
        const n = data.length;
        if (n === 0) return;
        const m = data[0].length;

        this.means = new Array(m).fill(0);
        this.stds = new Array(m).fill(0);

        // Calculate means
        for (let i = 0; i < n; i++) {
            for (let j = 0; j < m; j++) {
                this.means[j] += data[i][j];
            }
        }
        for (let j = 0; j < m; j++) {
            this.means[j] /= n;
        }

        // Calculate standard deviations
        for (let i = 0; i < n; i++) {
            for (let j = 0; j < m; j++) {
                this.stds[j] += Math.pow(data[i][j] - this.means[j], 2);
            }
        }
        for (let j = 0; j < m; j++) {
            const variance = this.stds[j] / n;
            // Prevent division by zero
            this.stds[j] = variance === 0 ? 1 : Math.sqrt(variance);
        }
    }

    /**
     * Scale data based on fitted parameters
     * @param {number[][]} data
     * @returns {number[][]}
     */
    transform(data) {
        return data.map(row => 
            row.map((val, j) => (val - this.means[j]) / this.stds[j])
        );
    }

    /**
     * Fit and scale data
     * @param {number[][]} data
     * @returns {number[][]}
     */
    fitTransform(data) {
        this.fit(data);
        return this.transform(data);
    }
}

// 3. PRINCIPAL COMPONENT ANALYSIS (PCA)
class PCA {
    constructor(nComponents = 2) {
        this.nComponents = nComponents;
        this.eigenvectors = []; // Shape [M, nComponents]
        this.eigenvalues = [];
        this.explainedVarianceRatio = [];
    }

    /**
     * Run PCA on scaled data
     * @param {number[][]} X - Scaled data [N, M]
     */
    fit(X) {
        const n = X.length;
        if (n <= 1) return;
        const m = X[0].length;

        // 1. Calculate Covariance Matrix of shape [M, M]
        const cov = Array.from({ length: m }, () => new Array(m).fill(0));
        for (let i = 0; i < m; i++) {
            for (let j = i; j < m; j++) {
                let sum = 0;
                for (let k = 0; k < n; k++) {
                    sum += X[k][i] * X[k][j];
                }
                const covariance = sum / (n - 1);
                cov[i][j] = covariance;
                cov[j][i] = covariance; // Symmetric matrix
            }
        }

        // 2. Jacobi Eigenvalue Algorithm for Symmetric Covariance Matrix
        const result = this.jacobiEigen(cov);
        let eigenvalues = result.eigenvalues;
        let eigenvectors = result.eigenvectors; // Column vectors in eigenvectors[i]

        // 3. Sort eigenvalues and corresponding eigenvectors in descending order
        const indices = Array.from({ length: m }, (_, i) => i);
        indices.sort((a, b) => eigenvalues[b] - eigenvalues[a]);

        const sortedEigenvalues = indices.map(i => eigenvalues[i]);
        const sortedEigenvectors = Array.from({ length: m }, () => new Array(m).fill(0));
        
        for (let j = 0; j < m; j++) {
            const origColIndex = indices[j];
            for (let i = 0; i < m; i++) {
                sortedEigenvectors[i][j] = eigenvectors[i][origColIndex];
            }
        }

        // Calculate explained variance ratio
        const totalVariance = sortedEigenvalues.reduce((sum, val) => sum + Math.max(0, val), 0);
        this.explainedVarianceRatio = sortedEigenvalues.map(val => totalVariance === 0 ? 0 : Math.max(0, val) / totalVariance);
        this.eigenvalues = sortedEigenvalues;

        // Keep only top nComponents
        this.eigenvectors = Array.from({ length: m }, () => new Array(this.nComponents).fill(0));
        for (let i = 0; i < m; i++) {
            for (let j = 0; j < this.nComponents; j++) {
                this.eigenvectors[i][j] = sortedEigenvectors[i][j];
            }
        }
    }

    /**
     * Project data onto the principal components
     * @param {number[][]} X - Scaled data [N, M]
     * @returns {number[][]} - Projected data [N, nComponents]
     */
    transform(X) {
        const n = X.length;
        if (n === 0) return [];
        const m = X[0].length;
        
        const projected = Array.from({ length: n }, () => new Array(this.nComponents).fill(0));
        for (let i = 0; i < n; i++) {
            for (let j = 0; j < this.nComponents; j++) {
                let sum = 0;
                for (let k = 0; k < m; k++) {
                    sum += X[i][k] * this.eigenvectors[k][j];
                }
                projected[i][j] = sum;
            }
        }
        return projected;
    }

    fitTransform(X) {
        this.fit(X);
        return this.transform(X);
    }

    /**
     * Jacobi Eigenvalue Algorithm for symmetric matrices
     * Finds all eigenvalues and eigenvectors of a symmetric matrix A
     */
    jacobiEigen(A, maxIterations = 100, tolerance = 1e-9) {
        const n = A.length;
        const eigenvalues = new Array(n).fill(0);
        const eigenvectors = Array.from({ length: n }, (_, i) => {
            const row = new Array(n).fill(0);
            row[i] = 1; // Start with identity matrix
            return row;
        });

        const mat = A.map(row => [...row]); // Copy matrix

        for (let iter = 0; iter < maxIterations; iter++) {
            // Find the largest off-diagonal element mat[p][q]
            let p = 0;
            let q = 1;
            let maxVal = Math.abs(mat[0][1]);

            for (let i = 0; i < n; i++) {
                for (let j = i + 1; j < n; j++) {
                    if (Math.abs(mat[i][j]) > maxVal) {
                        maxVal = Math.abs(mat[i][j]);
                        p = i;
                        q = j;
                    }
                }
            }

            // If largest off-diagonal element is below tolerance, we are done
            if (maxVal < tolerance) {
                break;
            }

            // Calculate rotation angle
            const ap = mat[p][p];
            const aq = mat[q][q];
            const apq = mat[p][q];

            let theta;
            if (Math.abs(ap - aq) < 1e-15) {
                theta = Math.PI / 4;
            } else {
                const tau = (aq - ap) / (2 * apq);
                let t = 1.0 / (Math.abs(tau) + Math.sqrt(1.0 + tau * tau));
                if (tau < 0) t = -t;
                theta = Math.atan(t);
            }

            const c = Math.cos(theta);
            const s = Math.sin(theta);

            // Apply rotation to mat (R^T * mat * R)
            const mat_pp = c * c * ap - 2 * s * c * apq + s * s * aq;
            const mat_qq = s * s * ap + 2 * s * c * apq + c * c * aq;
            mat[p][p] = mat_pp;
            mat[q][q] = mat_qq;
            mat[p][q] = 0;
            mat[q][p] = 0;

            for (let i = 0; i < n; i++) {
                if (i !== p && i !== q) {
                    const aip = mat[i][p];
                    const aiq = mat[i][q];
                    mat[i][p] = c * aip - s * aiq;
                    mat[p][i] = mat[i][p];
                    mat[i][q] = s * aip + c * aiq;
                    mat[q][i] = mat[i][q];
                }
            }

            // Update eigenvectors matrix (accumulate rotations)
            for (let i = 0; i < n; i++) {
                const vip = eigenvectors[i][p];
                const viq = eigenvectors[i][q];
                eigenvectors[i][p] = c * vip - s * viq;
                eigenvectors[i][q] = s * vip + c * viq;
            }
        }

        // Extract diagonal elements as eigenvalues
        for (let i = 0; i < n; i++) {
            eigenvalues[i] = mat[i][i];
        }

        return { eigenvalues, eigenvectors };
    }
}

// 4. K-MEANS CLUSTERING
class KMeans {
    constructor(k = 3, maxIterations = 100) {
        this.k = k;
        this.maxIterations = maxIterations;
        this.centroids = []; // Centroids in scaled feature space
        this.labels = []; // Labels for each data point
    }

    /**
     * Standard Euclidean distance helper
     */
    static distance(pt1, pt2) {
        let sum = 0;
        for (let i = 0; i < pt1.length; i++) {
            sum += Math.pow(pt1[i] - pt2[i], 2);
        }
        return Math.sqrt(sum);
    }

    /**
     * K-Means++ Initialization
     * Select centroids that are far apart from each other
     */
    initCentroids(X) {
        const n = X.length;
        const m = X[0].length;
        const centroids = [];

        // 1. Choose first centroid randomly
        const firstIdx = Math.floor(Math.random() * n);
        centroids.push([...X[firstIdx]]);

        // 2. Select remaining centroids
        for (let c = 1; c < this.k; c++) {
            const distSq = new Array(n).fill(0);
            let sumDistSq = 0;

            for (let i = 0; i < n; i++) {
                // Find min distance to existing centroids
                let minCentDistSq = Infinity;
                for (let j = 0; j < centroids.length; j++) {
                    const d = KMeans.distance(X[i], centroids[j]);
                    const dSq = d * d;
                    if (dSq < minCentDistSq) {
                        minCentDistSq = dSq;
                    }
                }
                distSq[i] = minCentDistSq;
                sumDistSq += minCentDistSq;
            }

            // Choose next centroid with probability proportional to distSq
            let r = Math.random() * sumDistSq;
            let cumulative = 0;
            let selectedIdx = n - 1;
            for (let i = 0; i < n; i++) {
                cumulative += distSq[i];
                if (cumulative >= r) {
                    selectedIdx = i;
                    break;
                }
            }
            centroids.push([...X[selectedIdx]]);
        }

        return centroids;
    }

    /**
     * Run K-Means Clustering
     * @param {number[][]} X - Scaled feature matrix
     */
    fit(X) {
        const n = X.length;
        if (n < this.k) return;
        const m = X[0].length;

        // Initialize centroids using K-Means++
        this.centroids = this.initCentroids(X);
        this.labels = new Array(n).fill(-1);

        let centroidsChanged = true;
        let iter = 0;

        while (centroidsChanged && iter < this.maxIterations) {
            centroidsChanged = false;
            iter++;

            // 1. Assign points to nearest centroid
            const newLabels = [];
            for (let i = 0; i < n; i++) {
                let minD = Infinity;
                let minLabel = -1;
                for (let c = 0; c < this.k; c++) {
                    const d = KMeans.distance(X[i], this.centroids[c]);
                    if (d < minD) {
                        minD = d;
                        minLabel = c;
                    }
                }
                newLabels.push(minLabel);
                if (minLabel !== this.labels[i]) {
                    centroidsChanged = true;
                }
            }
            this.labels = newLabels;

            // 2. Recompute centroids
            const newCentroids = Array.from({ length: this.k }, () => new Array(m).fill(0));
            const counts = new Array(this.k).fill(0);

            for (let i = 0; i < n; i++) {
                const label = this.labels[i];
                counts[label]++;
                for (let j = 0; j < m; j++) {
                    newCentroids[label][j] += X[i][j];
                }
            }

            for (let c = 0; c < this.k; c++) {
                if (counts[c] > 0) {
                    for (let j = 0; j < m; j++) {
                        newCentroids[c][j] /= counts[c];
                    }
                    this.centroids[c] = newCentroids[c];
                } else {
                    // Reinitialize empty cluster with a random point
                    const randIdx = Math.floor(Math.random() * n);
                    this.centroids[c] = [...X[randIdx]];
                    centroidsChanged = true;
                }
            }
        }
    }

    /**
     * Order cluster labels so that they match economic definitions logically:
     * Label 0: Bear (lowest return, highest vol)
     * Label 1: Sideways (return near zero, lowest/low vol)
     * Label 2: Bull (highest return, low/medium vol)
     * Returns a map from original cluster label to sorted label
     * @param {number[][]} unscaledFeatures - Original features (returns, vol) used for profiling
     * @returns {number[]} mapping array where mapping[orig_label] = sorted_label
     */
    getLogicalRegimeMapping(unscaledFeatures) {
        // Calculate average return and volatility for each cluster
        const n = this.labels.length;
        const stats = Array.from({ length: this.k }, (_, i) => ({
            id: i,
            count: 0,
            avgReturn: 0,
            avgVol: 0
        }));

        for (let i = 0; i < n; i++) {
            const label = this.labels[i];
            stats[label].count++;
            // Assume 0 is return, 1 is volatility
            stats[label].avgReturn += unscaledFeatures[i][0];
            stats[label].avgVol += unscaledFeatures[i][1];
        }

        stats.forEach(s => {
            if (s.count > 0) {
                s.avgReturn /= s.count;
                s.avgVol /= s.count;
            }
        });

        // Let's sort based on Return/Vol profile.
        // Bear is negative/low returns, high vol.
        // Bull is high return, lower vol.
        // Sideways is average return (near zero), low vol.
        // Sorting strategy:
        // Rank by average return (ascending)
        const sortedByReturn = [...stats].sort((a, b) => a.avgReturn - b.avgReturn);
        
        const mapping = new Array(this.k).fill(-1);
        if (this.k === 3) {
            // Label 0 = Bear (lowest return, usually high volatility)
            // Label 1 = Sideways (middle return, usually lower volatility)
            // Label 2 = Bull (highest return)
            mapping[sortedByReturn[0].id] = 0; // Bear
            mapping[sortedByReturn[1].id] = 1; // Sideways
            mapping[sortedByReturn[2].id] = 2; // Bull
        } else {
            // For general k, just rank by return ascending
            sortedByReturn.forEach((s, idx) => {
                mapping[s.id] = idx;
            });
        }
        return mapping;
    }
}

// 5. HIERARCHICAL CLUSTERING (Agglomerative)
class HierarchicalClustering {
    constructor(linkage = 'average') {
        this.linkage = linkage; // 'single', 'complete', 'average'
    }

    /**
     * Run agglomerative clustering on scaled data
     * Returns a merge tree structure suitable for dendrogram rendering
     * @param {number[][]} X - Scaled data of shape [N, M]
     * @returns {Object} Root node of the merge tree
     */
    fit(X) {
        const n = X.length;
        if (n === 0) return null;

        // Initialize clusters: each point is its own leaf cluster
        let clusters = Array.from({ length: n }, (_, i) => ({
            id: i,
            label: `Pt ${i}`,
            points: [i],
            height: 0,
            left: null,
            right: null
        }));

        // Precompute initial pairwise distance matrix
        // dist[i][j] = distance between clusters[i] and clusters[j]
        const dist = Array.from({ length: n }, () => new Array(n).fill(0));
        for (let i = 0; i < n; i++) {
            for (let j = i + 1; j < n; j++) {
                const d = KMeans.distance(X[i], X[j]);
                dist[i][j] = d;
                dist[j][i] = d;
            }
        }

        // Active clusters tracking (by index in clusters array)
        let active = Array.from({ length: n }, (_, i) => i);

        // Keep merging until only one cluster remains
        let clusterCounter = n;
        while (active.length > 1) {
            let minD = Infinity;
            let mergeI = -1;
            let mergeJ = -1;

            // Find pair of active clusters with minimum distance
            for (let i = 0; i < active.length; i++) {
                for (let j = i + 1; j < active.length; j++) {
                    const c1 = active[i];
                    const c2 = active[j];
                    const d = dist[c1][c2];
                    if (d < minD) {
                        minD = d;
                        mergeI = i;
                        mergeJ = j;
                    }
                }
            }

            const cIdx1 = active[mergeI];
            const cIdx2 = active[mergeJ];
            const cluster1 = clusters[cIdx1];
            const cluster2 = clusters[cIdx2];

            // Merge cluster1 and cluster2 into a new parent cluster
            const parent = {
                id: clusterCounter++,
                label: `Node ${clusterCounter - n}`,
                points: [...cluster1.points, ...cluster2.points],
                height: minD,
                left: cluster1,
                right: cluster2
            };
            clusters.push(parent);
            const parentIdx = clusters.length - 1;

            // Update distance matrix for the new cluster
            dist.push(new Array(clusters.length).fill(0));
            for (let i = 0; i < dist.length; i++) {
                dist[i].push(0);
            }

            // Calculate distance from the new parent cluster to all other clusters
            for (let i = 0; i < clusters.length - 1; i++) {
                if (i === cIdx1 || i === cIdx2) continue;

                let d = 0;
                if (this.linkage === 'single') {
                    d = Math.min(dist[cIdx1][i], dist[cIdx2][i]);
                } else if (this.linkage === 'complete') {
                    d = Math.max(dist[cIdx1][i], dist[cIdx2][i]);
                } else {
                    // Average linkage
                    const n1 = cluster1.points.length;
                    const n2 = cluster2.points.length;
                    d = (n1 * dist[cIdx1][i] + n2 * dist[cIdx2][i]) / (n1 + n2);
                }
                dist[parentIdx][i] = d;
                dist[i][parentIdx] = d;
            }

            // Remove cluster1 and cluster2 from active list, and add the parent
            active = active.filter((_, idx) => idx !== mergeI && idx !== mergeJ);
            active.push(parentIdx);
        }

        // Root of the merge tree is the last remaining active cluster
        return clusters[active[0]];
    }

    /**
     * Get clusters at a specific height or number of clusters threshold
     * Traverses the tree bottom-up to assign labels
     */
    static getLabels(root, k, totalPoints) {
        const labels = new Array(totalPoints).fill(0);
        
        // Find nodes to split by looking at the queue sorted by height descending
        const queue = [root];
        while (queue.length < k) {
            // Find node in queue with largest height that has children (is not leaf)
            let splitIdx = -1;
            let maxHeight = -1;
            for (let i = 0; i < queue.length; i++) {
                const node = queue[i];
                if (node.left && node.right && node.height > maxHeight) {
                    maxHeight = node.height;
                    splitIdx = i;
                }
            }

            if (splitIdx === -1) break; // All remaining are leaves

            const nodeToSplit = queue[splitIdx];
            queue.splice(splitIdx, 1);
            queue.push(nodeToSplit.left);
            queue.push(nodeToSplit.right);
        }

        // Assign labels based on the final subtrees
        queue.forEach((clusterNode, clusterIdx) => {
            clusterNode.points.forEach(ptIdx => {
                labels[ptIdx] = clusterIdx;
            });
        });

        return labels;
    }
}

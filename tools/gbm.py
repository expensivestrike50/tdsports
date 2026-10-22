"""A small histogram gradient-boosting regressor in numpy (squared loss).

Each feature is cut into up to 64 quantile bins. Trees grow level by level to a fixed
depth; at each level, every node's best split is found from per-bin gradient sums (one
np.bincount per feature for the whole level). Each tree is fitted to the residuals of the
ones before it on a random half of the rows, its output scaled by the learning rate, and
training stops when the error on a held-back validation set stops improving.
"""
import numpy as np


class GBM:
    def __init__(self, depth=5, rate=0.08, trees=600, min_leaf=150, l2=10.0, subsample=0.5, bins=64, patience=30, seed=0):
        self.depth, self.rate, self.max_trees, self.min_leaf = depth, rate, trees, min_leaf
        self.l2, self.subsample, self.nbins, self.patience = l2, subsample, bins, patience
        self.rng = np.random.default_rng(seed)

    def _bin(self, X):
        return np.stack([np.searchsorted(self.edges[j], X[:, j], side='right') for j in range(X.shape[1])], axis=1).astype(np.int16)

    def fit(self, X, y, X_val=None, y_val=None, log=None):
        X, y = np.asarray(X, float), np.asarray(y, float)
        qs = np.linspace(0, 1, self.nbins + 1)[1:-1]
        self.edges = [np.unique(np.quantile(X[:, j], qs)) for j in range(X.shape[1])]
        B = self._bin(X)
        self.base = float(np.mean(y))
        pred = np.full(len(y), self.base)
        if X_val is not None:
            Bv, pv = self._bin(np.asarray(X_val, float)), np.full(len(y_val), self.base)
            best, best_n, since = np.inf, 0, 0
        self.trees = []
        for t in range(self.max_trees):
            rows = np.flatnonzero(self.rng.random(len(y)) < self.subsample)
            tree = self._grow(B[rows], (y - pred)[rows])
            self.trees.append(tree)
            pred += self.rate * self._apply(tree, B)
            if X_val is not None:
                pv += self.rate * self._apply(tree, Bv)
                err = float(np.mean(np.abs(y_val - pv)))
                if err < best - 1e-5:
                    best, best_n, since = err, t + 1, 0
                else:
                    since += 1
                    if since >= self.patience:
                        break
                if log and t % 50 == 0:
                    log(f'      tree {t}: validation error {err:.4f}')
        if X_val is not None:
            self.trees = self.trees[:best_n]
        return self

    def _grow(self, B, g):
        """One tree: arrays of (feature, threshold bin, left, right, value) per node."""
        n, F = B.shape
        nb = self.nbins
        node = np.zeros(n, np.int64)          # node index of each row at the current level
        feat, thr, left, right, value = [-1], [0], [-1], [-1], [0.0]
        frontier = [0]
        for _ in range(self.depth):
            k = len(frontier)
            pos = {nid: i for i, nid in enumerate(frontier)}
            local = np.array([pos.get(x, -1) for x in range(len(feat))])[node]
            act = local >= 0
            if not act.any():
                break
            li, gi = local[act], g[act]
            cnt_tot = np.bincount(li, minlength=k).astype(float)
            sum_tot = np.bincount(li, weights=gi, minlength=k)
            best_gain, best_f, best_b = np.zeros(k), np.full(k, -1), np.zeros(k, int)
            for f in range(F):
                idx = li * nb + B[act, f]
                c = np.bincount(idx, minlength=k * nb).reshape(k, nb).astype(float)
                s = np.bincount(idx, weights=gi, minlength=k * nb).reshape(k, nb)
                cl, sl = np.cumsum(c, axis=1)[:, :-1], np.cumsum(s, axis=1)[:, :-1]
                cr, sr = cnt_tot[:, None] - cl, sum_tot[:, None] - sl
                ok = (cl >= self.min_leaf) & (cr >= self.min_leaf)
                gain = np.where(ok, sl ** 2 / (cl + self.l2) + sr ** 2 / (cr + self.l2) - (sum_tot ** 2 / (cnt_tot + self.l2))[:, None], 0)
                b = gain.argmax(axis=1)
                gbest = gain[np.arange(k), b]
                better = gbest > best_gain
                best_gain[better], best_f[better], best_b[better] = gbest[better], f, b[better]
            new_frontier = []
            for i, nid in enumerate(frontier):
                value[nid] = float(sum_tot[i] / (cnt_tot[i] + self.l2))
                if best_f[i] < 0:
                    continue
                l, r = len(feat), len(feat) + 1
                feat[nid], thr[nid], left[nid], right[nid] = int(best_f[i]), int(best_b[i]), l, r
                feat += [-1, -1]; thr += [0, 0]; left += [-1, -1]; right += [-1, -1]; value += [0.0, 0.0]
                new_frontier += [l, r]
            # move rows down
            for nid in frontier:
                if feat[nid] >= 0:
                    rows = node == nid
                    go_right = B[rows, feat[nid]] > thr[nid]
                    sub = np.flatnonzero(rows)
                    node[sub[go_right]] = right[nid]
                    node[sub[~go_right]] = left[nid]
            frontier = new_frontier
            if not frontier:
                break
        # leaf values for the last level
        if frontier:
            leaf = np.isin(node, frontier)
            cnt = np.bincount(node[leaf], minlength=len(feat)).astype(float)
            sm = np.bincount(node[leaf], weights=g[leaf], minlength=len(feat))
            for nid in frontier:
                value[nid] = float(sm[nid] / (cnt[nid] + self.l2))
        return np.array(feat), np.array(thr), np.array(left), np.array(right), np.array(value)

    @staticmethod
    def _apply(tree, B):
        feat, thr, left, right, value = tree
        node = np.zeros(len(B), np.int64)
        for _ in range(16):
            f = feat[node]
            inner = f >= 0
            if not inner.any():
                break
            idx = np.flatnonzero(inner)
            go = B[idx, f[idx]] > thr[node[idx]]
            node[idx] = np.where(go, right[node[idx]], left[node[idx]])
        return value[node]

    def predict(self, X):
        B = self._bin(np.asarray(X, float))
        out = np.full(len(B), self.base)
        for tree in self.trees:
            out += self.rate * self._apply(tree, B)
        return out

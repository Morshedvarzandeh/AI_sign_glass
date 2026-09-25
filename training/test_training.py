import tempfile
import unittest
from pathlib import Path

from train import load_checkpoint, loss_and_grad, metrics, normalize, probabilities, save_checkpoint
from prepare import resolve_rows, temporal_features
import numpy as np


class TrainingTests(unittest.TestCase):
    def test_gradients_match_finite_differences(self):
        rng = np.random.default_rng(11)
        params = {"w1": rng.normal(size=(3, 4)), "b1": np.ones(4), "w2": rng.normal(size=(4, 2)), "b2": np.zeros(2)}
        x, y = rng.normal(size=(5, 3)), np.array([0, 1, 1, 0, 1])
        _, grads = loss_and_grad(params, x, y, l2=0.01)
        epsilon = 1e-5
        for key, array in params.items():
            for index in np.ndindex(array.shape):
                original = array[index]
                array[index] = original + epsilon
                plus = loss_and_grad(params, x, y, l2=0.01)[0]
                array[index] = original - epsilon
                minus = loss_and_grad(params, x, y, l2=0.01)[0]
                array[index] = original
                self.assertAlmostEqual(grads[key][index], (plus-minus)/(2*epsilon), places=6)

    def test_checkpoint_roundtrip_preserves_predictions(self):
        rng = np.random.default_rng(4)
        params = {"w1": rng.normal(size=(3, 4)).astype(np.float32), "b1": np.ones(4, dtype=np.float32), "w2": rng.normal(size=(4, 2)).astype(np.float32), "b2": np.zeros(2, dtype=np.float32)}
        x = rng.normal(size=(8, 3)).astype(np.float32)
        mean, scale = np.zeros(3), np.ones(3)
        with tempfile.TemporaryDirectory() as d:
            path = Path(d)/"best.npz"
            save_checkpoint(path, params, mean, scale, ["A", "B"], {"epoch": 2})
            restored, mean2, scale2, labels, info = load_checkpoint(path)
            np.testing.assert_array_equal(probabilities(params, x), probabilities(restored, x))
            np.testing.assert_array_equal(mean, mean2)
            np.testing.assert_array_equal(scale, scale2)
            self.assertEqual(labels, ["A", "B"])
            self.assertEqual(info["epoch"], 2)

    def test_metrics_use_true_labels_and_include_zero_recall_classes(self):
        probs = np.array([[.8,.1,.1],[.5,.4,.1],[.1,.2,.7],[.2,.5,.3]])
        result, confusion, per_class = metrics(probs, np.array([0,1,2,2]), 3)
        self.assertEqual(result["correct"], 2)
        self.assertEqual(result["top1_accuracy"], .5)
        self.assertEqual(confusion.sum(), 4)
        self.assertEqual(per_class[1]["recall"], 0)
        self.assertAlmostEqual(result["balanced_accuracy"], .5)

    def test_motion_features_preserve_time_order(self):
        forward = np.zeros((200,450), dtype=np.float32)
        forward[:,:225] = np.linspace(0,1,200)[:,None]
        a, b = temporal_features(forward), temporal_features(forward[::-1])
        self.assertEqual(a.shape, (4050,))
        self.assertFalse(np.allclose(a[:3600], b[:3600]))
        np.testing.assert_allclose(a[3600:], b[3600:], atol=1e-6)
        with self.assertRaises(ValueError):
            temporal_features(np.zeros((200,450)))
        forward[10,0] = np.nan
        with self.assertRaises(ValueError):
            temporal_features(forward)

    def test_official_splits_override_mirror_and_remove_duplicates(self):
        rows = [{"filename": "one.pkl", "label": "HELLO", "split": "train"}, {"filename": "two.pkl", "label": "HURDLE-TRIP1", "split": "train"}]
        original = {"one": ("test", "P1", "HELLO"), "two": ("train", "P2", "HURDLE/TRIP1")}
        selected, count = resolve_rows([rows, [rows[0]]], original)
        self.assertEqual(count, 1)
        self.assertEqual(selected[0]["official_split"], "test")
        self.assertEqual(selected[1]["canonical_label"], "HURDLE/TRIP1")
        original["two"] = ("train", "P1", "HURDLE/TRIP1")
        with self.assertRaisesRegex(ValueError, "Signer overlap"):
            resolve_rows([rows], original)

    def test_conflicting_labels_fail(self):
        with self.assertRaisesRegex(ValueError, "Conflicting label"):
            resolve_rows([[{"filename":"one.pkl", "label":"YES"}]], {"one":("train","P1","NO")})

    def test_normalization_uses_supplied_training_statistics(self):
        x = np.array([[100, -100], [1,2]], dtype=np.float32)
        result = normalize(x, np.array([1,1]), np.array([1,2]))
        np.testing.assert_array_equal(result, [[6,-6],[0,.5]])


if __name__ == "__main__":
    unittest.main()

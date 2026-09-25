import unittest
import tempfile
import json
from pathlib import Path

import numpy as np

from motion_features import FRAME_DIM, FEATURE_DIM, causal_smooth, motion_features, skeleton_frames
from train_motion import validate
from prepare_motion import digest
from prepare import write_json


def sample_sequence():
    points = np.zeros((200, 75, 3), dtype=np.float32)
    points[:, 11] = [-0.5, 0, 0]
    points[:, 12] = [0.5, 0, 0]
    points[:, 0] = [0, -0.6, 0]
    for start, side in [(33, -1), (54, 1)]:
        wrist = np.zeros((200, 3), dtype=np.float32)
        wrist[:, 0] = side * (0.4 + np.linspace(0, 0.3, 200))
        wrist[:, 1] = 0.3
        shape = np.zeros((21, 3), dtype=np.float32)
        shape[:, 0] = np.linspace(-.1,.1,21)
        shape[:, 1] = np.linspace(0,-.3,21)
        shape[0] = 0
        points[:, start:start+21] = wrist[:, None] + shape[None]
    result = np.zeros((200,450),dtype=np.float32)
    result[:,:225] = points.reshape(200,225)
    return result


class MotionTests(unittest.TestCase):
    def test_global_translation_and_scale_invariance(self):
        sample = sample_sequence()
        changed = sample.copy()
        points = changed[:,:225].reshape(200,75,3)
        points[:] = points * 2.5 + np.array([3,-2,1],dtype=np.float32)
        np.testing.assert_allclose(motion_features(sample), motion_features(changed), atol=3e-5)

    def test_local_shape_is_separate_from_wrist_location(self):
        sample = sample_sequence()
        values, _ = skeleton_frames(sample)
        self.assertEqual(values.shape, (200,FRAME_DIM))
        np.testing.assert_allclose(values[0,21:84], values[-1,21:84],atol=1e-6)
        self.assertNotEqual(values[0,84], values[-1,84])
        self.assertEqual(values[0,87], 1)
        self.assertEqual(values[0,154], 1)

    def test_smoothing_is_causal_and_resets_across_missing_values(self):
        x = np.array([[1.],[3.],[100.],[9.],[11.]],dtype=np.float32)
        valid = np.array([[1],[1],[0],[1],[1]],dtype=bool)
        expected = np.array([[1.],[2.],[0.],[9.],[10.]],dtype=np.float32)
        np.testing.assert_array_equal(causal_smooth(x,valid),expected)
        x[4] = -999
        np.testing.assert_array_equal(causal_smooth(x,valid)[:4],expected[:4])

    def test_time_direction_is_preserved(self):
        sample = sample_sequence()
        forward, backward = motion_features(sample), motion_features(sample[::-1])
        self.assertEqual(forward.shape, (FEATURE_DIM,))
        self.assertFalse(np.allclose(forward,backward))
        velocity_offset = 16*FRAME_DIM
        right_wrist_x = 151
        self.assertGreater(forward[velocity_offset+right_wrist_x],0)
        self.assertLess(backward[velocity_offset+right_wrist_x],0)

    def test_missing_hand_has_no_shape_or_wrist_motion(self):
        sample = sample_sequence()
        points = sample[:,:225].reshape(200,75,3)
        points[:,33:54] = 0
        values, mask = skeleton_frames(sample)
        self.assertTrue(np.all(values[:,21:88]==0))
        self.assertFalse(np.any(mask[:,21:87]))
        self.assertTrue(np.isfinite(motion_features(sample)).all())

    def test_invalid_input_rejected(self):
        with self.assertRaises(ValueError): motion_features(np.zeros((4,3)))
        sample = sample_sequence(); sample[10,5] = np.nan
        with self.assertRaises(ValueError): motion_features(sample)

    def test_dataset_validation_rejects_changed_files_and_signer_leakage(self):
        with tempfile.TemporaryDirectory() as directory:
            data = Path(directory)
            labels = ["YES", "NO"]
            write_json(data/"labels.json", labels)
            for split in ["train", "val", "test"]:
                np.save(data/f"{split}_x.npy", np.ones((2,FEATURE_DIM),dtype=np.float32))
                np.save(data/f"{split}_y.npy", np.array([0,1]))
                write_json(data/f"{split}_clips.json", [
                    {"clip_id":f"{split}-{i}","signer":f"signer-{split}","label_id":i,"label":label}
                    for i,label in enumerate(labels)])
            audit = {"status":"prepared", "feature_version":"bimanual-motion-v2", "input_features":FEATURE_DIM,
                     "feature_code_sha256":digest(Path(__file__).with_name("motion_features.py")),
                     "classes":2,"clip_overlap":0,"signer_overlap":0,"identical_feature_overlap":0,
                     "prepared_sha256":{p.name:digest(p) for p in data.glob("*.npy")},
                     "metadata_sha256":{p.name:digest(p) for p in data.glob("*_clips.json")},
                     "labels_sha256":digest(data/"labels.json")}
            validate(data,audit,labels)
            np.save(data/"val_x.npy", np.zeros((2,FEATURE_DIM),dtype=np.float32))
            with self.assertRaisesRegex(ValueError,"file changed"):
                validate(data,audit,labels)
            audit["prepared_sha256"]["val_x.npy"] = digest(data/"val_x.npy")
            rows = json.loads((data/"val_clips.json").read_text())
            rows[0]["signer"] = "signer-train"
            write_json(data/"val_clips.json", rows)
            audit["metadata_sha256"]["val_clips.json"] = digest(data/"val_clips.json")
            with self.assertRaisesRegex(ValueError,"Split leakage"):
                validate(data,audit,labels)


if __name__ == "__main__":
    unittest.main()

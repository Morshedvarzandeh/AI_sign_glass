"""Small body-relative, bimanual motion representation using existing landmarks.

Inspired by temporal skeleton tracking; no GEM-X code, weights, or dependency.
Input remains the pinned MediaPipe-based dataset's 200x450 feature sequence.
"""
import numpy as np

VERSION = "bimanual-motion-v2"
FRAME_DIM = 155
FEATURE_DIM = FRAME_DIM * 34
UPPER_BODY = [0, 11, 12, 13, 14, 15, 16]


def causal_smooth(values, valid, window=5):
    """Average recent valid samples, resetting each coordinate across gaps."""
    if values.shape != valid.shape or values.ndim != 2 or window < 1:
        raise ValueError("Expected matching time-by-feature values and masks")
    valid = np.asarray(valid, dtype=bool)
    total = np.where(valid, values, 0).astype(np.float32)
    count = valid.astype(np.float32)
    contiguous = valid.copy()
    for lag in range(1, min(window, len(values))):
        previous = np.zeros_like(valid)
        previous[lag:] = valid[:-lag]
        contiguous &= previous
        shifted = np.zeros_like(values)
        shifted[lag:] = values[:-lag]
        total += np.where(contiguous, shifted, 0)
        count += contiguous
    return np.divide(total, count, out=np.zeros_like(total), where=count > 0)


def skeleton_frames(sample):
    """Separate local finger shape from wrist/arm location in body coordinates."""
    if sample.shape != (200, 450):
        raise ValueError("Expected a 200x450 preprocessed landmark sequence")
    positions = np.asarray(sample[:, :225], dtype=np.float32).reshape(200, 75, 3)
    if not np.isfinite(positions).all() or np.max(np.abs(positions)) > 10000:
        raise ValueError("Invalid landmark values")
    center = (positions[:, 11] + positions[:, 12]) / 2
    shoulder_width = np.linalg.norm(positions[:, 11, :2] - positions[:, 12, :2], axis=1)
    body_valid = shoulder_width > 1e-4
    scale = np.where(body_valid, shoulder_width, 1)
    body = (positions[:, UPPER_BODY] - center[:, None]) / scale[:, None, None]
    parts = [np.clip(body, -5, 5).reshape(200, -1)]
    masks = [np.repeat(body_valid[:, None], 21, axis=1)]
    for start in [33, 54]:
        hand = positions[:, start:start+21]
        relative = hand - hand[:, :1]
        palm_size = (np.linalg.norm(relative[:, 9], axis=1) + np.linalg.norm(hand[:, 5]-hand[:, 17], axis=1)) / 2
        # A missing hand becomes 21 identical coordinates after upstream centering.
        present = body_valid & (palm_size > 1e-4)
        local = relative / np.where(present, palm_size, 1)[:, None, None]
        wrist = (hand[:, 0]-center) / scale[:, None]
        parts.extend([np.clip(local, -5, 5).reshape(200, -1), np.clip(wrist, -5, 5), present.astype(np.float32)[:, None]])
        masks.extend([np.repeat(present[:, None], 63, axis=1), np.repeat(present[:, None], 3, axis=1), np.ones((200, 1), dtype=bool)])
    values = np.concatenate(parts, axis=1)
    valid = np.concatenate(masks, axis=1)
    return np.where(valid, values, 0), valid


def motion_features(sample):
    values, valid = skeleton_frames(sample)
    smooth = causal_smooth(values, valid)
    velocity = np.zeros_like(smooth)
    velocity[1:] = (smooth[1:] - smooth[:-1]) * (len(smooth)-1)
    velocity[1:] *= valid[1:] & valid[:-1]
    # Presence is quality metadata, not movement. Do not encode its derivative.
    velocity[:, [87, 154]] = 0
    velocity = np.clip(velocity, -20, 20)
    position_bins = np.stack([x.mean(axis=0) for x in np.array_split(smooth, 16)])
    velocity_bins = np.stack([x.mean(axis=0) for x in np.array_split(velocity, 16)])
    result = np.concatenate([position_bins.ravel(), velocity_bins.ravel(), smooth.std(axis=0), np.abs(velocity).mean(axis=0)])
    if result.shape != (FEATURE_DIM,) or not np.isfinite(result).all():
        raise ValueError("Invalid motion representation")
    return result.astype(np.float32)

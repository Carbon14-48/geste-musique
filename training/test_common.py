"""Vérifie que la normalisation Python est identique à celle du navigateur (fichier généré par le JS)."""

import json

import numpy as np

from common import (
    HAGRID_V2_MAP, ROOT, augment_2d, augment_world, down_for, fingers_for, hand_features_2d, normalize_pose,
    resample_uniform, sequence_features, subject_split,
)

FIXTURE = json.loads((ROOT / "shared" / "normalize_fixture.json").read_text())


def test_normalize_pose_matches_js():
    for case in FIXTURE["cases"]:
        out = normalize_pose(np.array(case["world"]), case["handedness"])
        np.testing.assert_allclose(out, case["pose"], atol=1e-9)


def test_sequence_features_match_js():
    seq = FIXTURE["sequence"]
    hands = [None if f is None else {k: (np.array(v) if k != "handedness" else v) for k, v in f.items()} for f in seq["frames"]]
    np.testing.assert_allclose(sequence_features(hands), np.array(seq["features"]), atol=1e-9)


def test_augment_keeps_shape_and_changes_points():
    w = np.array(FIXTURE["cases"][0]["world"])
    a = augment_world(w, np.random.default_rng(0))
    assert a.shape == (21, 3)
    assert not np.allclose(a, w)


def test_resample_uniform():
    assert resample_uniform(list(range(10)), 4) == [0, 3, 6, 9]


def test_subject_split_keeps_people_apart():
    subjects = np.array(["a"] * 5 + ["b"] * 5 + ["c"] * 5 + ["d"] * 5 + ["e"] * 5)
    tr, va = subject_split(subjects, 0.2)
    assert set(subjects[tr]).isdisjoint(set(subjects[va]))
    assert va.any() and tr.any()


def test_hand_features_2d_match_js():
    for case in FIXTURE["cases2d"]:
        out = hand_features_2d(np.array(case["image"]), case["handedness"], case["aspect"])
        np.testing.assert_allclose(out, case["features"], atol=1e-9)


def test_fingers_table_and_hagrid_overrides():
    np.testing.assert_array_equal(fingers_for("rock"), [0, 1, 0, 0, 1])
    np.testing.assert_array_equal(fingers_for("three", "three2"), [1, 1, 1, 0, 0])  # mesuré sur HaGRID
    assert fingers_for("other") is None
    np.testing.assert_array_equal(fingers_for("other", "middle_finger"), [0, 0, 1, 0, 0])


def test_hagrid_v2_map():
    assert HAGRID_V2_MAP["stop"] == "four"  # pouce replié dans « stop »
    assert HAGRID_V2_MAP["palm"] == "palm"
    assert HAGRID_V2_MAP["no_gesture"] == "other"
    assert down_for("peace_inverted") == 1.0 and down_for("peace") == 0.0 and down_for("like") is None


def test_augment_2d_keeps_shape_and_changes_points():
    img = np.array(FIXTURE["cases2d"][0]["image"])
    a = augment_2d(img, np.random.default_rng(0))
    assert a.shape == (21, 2)
    assert not np.allclose(a, img[:, :2])

"""Entraîne le classifieur de gestes dynamiques (modèle B : balayages, cercles, secouer…).

Entrées possibles (combinables) :
  --npz   fichiers produits par extract_videos.py (Jester, IPN Hand, vos vidéos)
  --json  fichiers exportés depuis l'onglet « Données » (séquences enregistrées dans l'application)

Exemples :
    python train_dynamic.py --npz data/jester_train.npz --json data/mes_sequences.json
    python train_dynamic.py --json data/mes_sequences.json --arch gru

Sortie : public/models/dynamic/{model.json, *.bin, labels.json}.
"""

from __future__ import annotations

import os

os.environ.setdefault("TF_USE_LEGACY_KERAS", "1")
os.environ.setdefault("TF_CPP_MIN_LOG_LEVEL", "2")

import argparse
from collections import Counter
from pathlib import Path

import numpy as np

from common import (
    FRAME_DIM, SEQ_STEPS, WEB_MODELS, augment_sequence, export_tfjs, legacy_keras, load_browser_dataset,
    resample_by_time, sequence_features, subject_split,
)


def load_sequences(npz_files: list[Path], json_files: list[Path]):
    """Renvoie une liste de séquences de mains (liste de dict ou None), étiquettes et sujets."""
    seqs, labels, subjects = [], [], []
    for f in npz_files:
        d = np.load(f, allow_pickle=False)
        for raw, present, side, label, subj in zip(d["raw"], d["present"], d["side"], d["label"], d["subject"]):
            seqs.append([
                {"world": raw[i, 0], "image": raw[i, 1], "handedness": str(side[i])} if present[i] else None
                for i in range(len(present))
            ])
            labels.append(str(label))
            subjects.append(f"{f.stem}:{subj}")
    for f in json_files:
        for s in load_browser_dataset(f)["sequences"]:
            frames = [{"t": fr["t"], "hand": fr["hand"]} for fr in s["frames"]]
            seqs.append(resample_by_time(frames, SEQ_STEPS))
            labels.append(s["label"])
            subjects.append(f"app:{s.get('subject', 'inconnu')}")
    return seqs, np.array(labels), np.array(subjects)


def featurize(seqs, rng=None, copies: int = 0):
    X, idx = [], []
    for i, s in enumerate(seqs):
        X.append(sequence_features(s))
        idx.append(i)
        for _ in range(copies):
            X.append(sequence_features(augment_sequence(s, rng)))
            idx.append(i)
    return np.array(X, dtype=np.float32), np.array(idx)


def build_model(n_classes: int, arch: str = "cnn"):
    keras = legacy_keras()
    inp = keras.layers.Input(shape=(SEQ_STEPS, FRAME_DIM))
    if arch == "gru":
        # reset_after=False : seule variante de GRU que TF.js sait charger.
        x = keras.layers.GRU(64, return_sequences=True, reset_after=False)(inp)
        x = keras.layers.GRU(64, reset_after=False)(x)
    else:
        # 1D-CNN : rapide dans le navigateur, très peu de paramètres.
        x = keras.layers.Conv1D(64, 3, padding="same", activation="relu")(inp)
        x = keras.layers.Conv1D(64, 3, padding="same", activation="relu")(x)
        x = keras.layers.MaxPooling1D(2)(x)
        x = keras.layers.Conv1D(96, 3, padding="same", activation="relu")(x)
        x = keras.layers.GlobalAveragePooling1D()(x)
    x = keras.layers.Dropout(0.3)(x)
    x = keras.layers.Dense(64, activation="relu")(x)
    out = keras.layers.Dense(n_classes, activation="softmax")(x)
    model = keras.Model(inp, out)
    model.compile(optimizer=keras.optimizers.Adam(1e-3), loss="sparse_categorical_crossentropy", metrics=["accuracy"])
    return model


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--npz", nargs="*", type=Path, default=[])
    ap.add_argument("--json", nargs="*", type=Path, default=[])
    ap.add_argument("--arch", choices=["cnn", "gru"], default="cnn")
    ap.add_argument("--epochs", type=int, default=60)
    ap.add_argument("--augment", type=int, default=4)
    ap.add_argument("--min-samples", type=int, default=8)
    ap.add_argument("--out", type=Path, default=WEB_MODELS / "dynamic")
    ap.add_argument("--seed", type=int, default=0)
    args = ap.parse_args()
    if not (args.npz or args.json):
        ap.error("donnez au moins --npz ou --json")

    rng = np.random.default_rng(args.seed)
    seqs, labels_raw, subjects = load_sequences(args.npz, args.json)
    counts = Counter(labels_raw)
    labels = sorted(str(l) for l, c in counts.items() if c >= args.min_samples)
    if len(labels) < 2:
        raise SystemExit(f"Pas assez de classes avec ≥ {args.min_samples} séquences : {dict(counts)}")
    print("Classes :", {l: counts[l] for l in labels})
    lab_idx = {l: i for i, l in enumerate(labels)}
    keep = [i for i, l in enumerate(labels_raw) if l in lab_idx]
    seqs = [seqs[i] for i in keep]
    y_all = np.array([lab_idx[labels_raw[i]] for i in keep])
    subjects = subjects[keep]

    train_mask, val_mask = subject_split(subjects, 0.2, args.seed)
    tr, va = np.where(train_mask)[0], np.where(val_mask)[0]
    X, idx = featurize([seqs[i] for i in tr], rng, args.augment)
    y = y_all[tr][idx]
    Xv, _ = featurize([seqs[i] for i in va])
    yv = y_all[va]
    print(f"Entraînement : {X.shape}, validation : {Xv.shape}")

    import tensorflow as tf
    from train_pose import report

    tf.random.set_seed(args.seed)
    model = build_model(len(labels), args.arch)
    freq = np.bincount(y, minlength=len(labels)).astype(float)
    class_weight = {i: float(len(y) / (len(labels) * max(f, 1))) for i, f in enumerate(freq)}
    model.fit(
        X, y, validation_data=(Xv, yv), epochs=args.epochs, batch_size=64, class_weight=class_weight, verbose=2,
        callbacks=[legacy_keras().callbacks.EarlyStopping(monitor="val_accuracy", patience=12, restore_best_weights=True)],
    )
    metrics = report(model, Xv, yv, labels)
    export_tfjs(model, labels, args.out, {"steps": SEQ_STEPS, "input": "sequenceFeatures (T x 67)", "val_accuracy": metrics["accuracy"]})


if __name__ == "__main__":
    main()

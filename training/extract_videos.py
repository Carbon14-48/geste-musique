"""Transforme des vidéos de gestes en séquences de points (T x 67) pour le modèle dynamique.

Deux organisations sont acceptées :

1. Jester (20BN) : un dossier d'images par vidéo + un CSV « id;classe »
    python extract_videos.py jester --frames data/jester/20bn-jester-v1 \
        --csv data/jester/jester-v1-train.csv --out data/jester_train.npz --max-per-class 1500

2. Un dossier par classe (IPN Hand, vos propres vidéos…) : <racine>/<classe>/<vidéo.mp4 ou dossier d'images>
    python extract_videos.py folders --root data/mes_videos --out data/mes_videos.npz

Les classes Jester sont converties avec JESTER_MAP (common.py) ; les autres sont ignorées.
"""

from __future__ import annotations

import argparse
import csv
from collections import Counter
from pathlib import Path

import numpy as np

from common import JESTER_MAP, SEQ_STEPS, create_landmarker, detect_hands, resample_uniform, sequence_features

VIDEO_EXT = (".mp4", ".avi", ".webm", ".mov", ".mkv")
IMAGE_EXT = (".jpg", ".jpeg", ".png")


def read_frames(path: Path, max_frames: int = 90):
    import cv2

    if path.is_dir():
        files = sorted(p for p in path.iterdir() if p.suffix.lower() in IMAGE_EXT)
        for f in resample_uniform(files, min(len(files), max_frames)) if files else []:
            img = cv2.imread(str(f))
            if img is not None:
                yield cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
        return
    cap = cv2.VideoCapture(str(path))
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT)) or max_frames
    keep = set(np.round(np.linspace(0, total - 1, min(total, max_frames))).astype(int).tolist())
    i = 0
    while True:
        ok, frame = cap.read()
        if not ok:
            break
        if i in keep:
            yield cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        i += 1
    cap.release()


def video_to_hands(landmarker, mp, path: Path) -> list[dict | None]:
    """Une main par image (la plus sûre, en restant du même côté que la précédente)."""
    hands, prev = [], None
    for rgb in read_frames(path):
        found = detect_hands(landmarker, mp, rgb)
        if not found:
            hands.append(None)
            continue
        if prev is not None:
            found.sort(key=lambda h: (h["handedness"] != prev["handedness"], -h["score"]))
        else:
            found.sort(key=lambda h: -h["score"])
        prev = found[0]
        hands.append(found[0])
    return hands


def encode(hands: list[dict | None]):
    """Rééchantillonne à SEQ_STEPS images et garde aussi les points bruts (pour l'augmentation)."""
    picked = resample_uniform(hands, SEQ_STEPS)
    raw = np.zeros((SEQ_STEPS, 2, 21, 3), dtype=np.float32)  # [:, 0] monde, [:, 1] image
    present = np.zeros(SEQ_STEPS, dtype=bool)
    side = np.array(["Right"] * SEQ_STEPS)
    for i, h in enumerate(picked):
        if h is not None:
            raw[i, 0], raw[i, 1], present[i], side[i] = h["world"], h["image"], True, h["handedness"]
    return sequence_features(picked).astype(np.float32), raw, present, side


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="layout", required=True)
    j = sub.add_parser("jester")
    j.add_argument("--frames", required=True, type=Path)
    j.add_argument("--csv", required=True, type=Path)
    f = sub.add_parser("folders")
    f.add_argument("--root", required=True, type=Path)
    for p in (j, f):
        p.add_argument("--out", required=True, type=Path)
        p.add_argument("--max-per-class", type=int, default=0)
        p.add_argument("--min-present", type=float, default=0.5, help="part minimale d'images avec une main")
    args = ap.parse_args()

    items: list[tuple[Path, str, str]] = []  # (chemin, étiquette, sujet)
    if args.layout == "jester":
        with open(args.csv, newline="", encoding="utf-8") as fh:
            for row in csv.reader(fh, delimiter=";"):
                if len(row) >= 2 and row[1] in JESTER_MAP:
                    items.append((args.frames / row[0], JESTER_MAP[row[1]], row[0]))
    else:
        for cls_dir in sorted(p for p in args.root.iterdir() if p.is_dir()):
            for v in sorted(cls_dir.iterdir()):
                if v.is_dir() or v.suffix.lower() in VIDEO_EXT:
                    items.append((v, cls_dir.name, v.stem.split("_")[0]))

    landmarker, mp = create_landmarker(num_hands=2)
    X, RAW, PRESENT, SIDE, y, subjects = [], [], [], [], [], []
    taken, skipped = Counter(), 0
    for n, (path, label, subject) in enumerate(items):
        if args.max_per_class and taken[label] >= args.max_per_class:
            continue
        if not path.exists():
            skipped += 1
            continue
        hands = video_to_hands(landmarker, mp, path)
        if not hands or sum(h is not None for h in hands) < args.min_present * len(hands):
            skipped += 1
            continue
        feats, raw, present, side = encode(hands)
        X.append(feats)
        RAW.append(raw)
        PRESENT.append(present)
        SIDE.append(side)
        y.append(label)
        subjects.append(subject)
        taken[label] += 1
        if n % 200 == 0:
            print(f"{n}/{len(items)} vidéos — {dict(taken)}")

    landmarker.close()
    args.out.parent.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(
        args.out, X=np.array(X), raw=np.array(RAW), present=np.array(PRESENT), side=np.array(SIDE),
        label=np.array(y), subject=np.array(subjects),
    )
    print(f"✔ {len(y)} séquences dans {args.out} ({skipped} ignorées)")
    print("Par classe :", dict(taken))


if __name__ == "__main__":
    main()

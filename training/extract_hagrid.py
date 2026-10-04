"""Extrait les 21 points de chaque main du jeu de données HaGRID avec MediaPipe.

On ne réutilise PAS les points fournis dans les annotations : on repasse chaque image dans
le même Hand Landmarker que l'application, pour que l'entraînement et le jeu voient les mêmes données.

Exemples :
    # HaGRID v1 (sous-échantillon ou version 512 px)
    python extract_hagrid.py --images data/hagrid/subsample --annotations data/hagrid/ann_subsample \
        --out data/hagrid_landmarks.npz --max-per-class 3000

    # HaGRID v2 : annotations dans annotations/train/<classe>.json
    python extract_hagrid.py --images data/hagrid_v2/hagrid_dataset --annotations data/hagrid_v2/annotations/train \
        --out data/hagrid_v2_train.npz
"""

from __future__ import annotations

import argparse
import json
from collections import Counter
from pathlib import Path

import numpy as np

from common import HAGRID_MAP, create_landmarker, detect_hands

IMAGE_EXT = (".jpg", ".jpeg", ".png")


def find_image(images_root: Path, cls: str, image_id: str) -> Path | None:
    for folder in (images_root / cls, images_root / f"train_val_{cls}", images_root):
        for ext in IMAGE_EXT:
            p = folder / f"{image_id}{ext}"
            if p.exists():
                return p
    return None


def crop_square(rgb: np.ndarray, bbox, margin: float = 0.6) -> np.ndarray:
    """bbox HaGRID = [x, y, w, h] normalisés. On découpe un carré élargi autour de la main."""
    h, w = rgb.shape[:2]
    x, y, bw, bh = bbox
    cx, cy = (x + bw / 2) * w, (y + bh / 2) * h
    side = max(bw * w, bh * h) * (1 + margin)
    x0, y0 = int(max(0, cx - side / 2)), int(max(0, cy - side / 2))
    x1, y1 = int(min(w, cx + side / 2)), int(min(h, cy + side / 2))
    return rgb[y0:y1, x0:x1]


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--images", required=True, type=Path, help="dossier des images (un sous-dossier par classe)")
    ap.add_argument("--annotations", required=True, type=Path, help="dossier des fichiers <classe>.json")
    ap.add_argument("--out", required=True, type=Path, help="fichier .npz de sortie")
    ap.add_argument("--max-per-class", type=int, default=0, help="limite d'images par classe (0 = toutes)")
    ap.add_argument("--classes", nargs="*", help="classes HaGRID à garder (défaut : toutes celles de HAGRID_MAP)")
    args = ap.parse_args()

    import cv2

    landmarker, mp = create_landmarker(num_hands=1)
    wanted = set(args.classes or HAGRID_MAP)
    worlds, images, handedness, labels, subjects = [], [], [], [], []
    stats = Counter()
    taken = Counter()  # compte global par étiquette (no_gesture apparaît dans tous les fichiers)

    for ann_file in sorted(args.annotations.glob("*.json")):
        cls = ann_file.stem
        if cls not in wanted and "no_gesture" not in wanted:
            continue
        ann = json.loads(ann_file.read_text())
        main_label = HAGRID_MAP.get(cls)
        for n, (image_id, a) in enumerate(ann.items()):
            path = find_image(args.images, cls, image_id)
            if path is None:
                stats["image manquante"] += 1
                continue
            bgr = cv2.imread(str(path))
            if bgr is None:
                continue
            rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
            boxes = a.get("bboxes") or a.get("united_bbox") or []
            for bbox, raw_label in zip(boxes, a.get("labels", [])):
                label = HAGRID_MAP.get(raw_label)
                if label is None or raw_label not in wanted:
                    continue
                if args.max_per_class and taken[label] >= args.max_per_class:
                    continue
                crop = crop_square(rgb, bbox)
                if crop.size == 0:
                    continue
                hands = detect_hands(landmarker, mp, crop)
                if not hands:
                    stats["main non détectée"] += 1
                    continue
                hand = max(hands, key=lambda h: h["score"])
                worlds.append(hand["world"])
                images.append(hand["image"])
                handedness.append(hand["handedness"])
                labels.append(label)
                subjects.append(a.get("user_id", f"{cls}_{image_id}"))
                taken[label] += 1
                stats["ok"] += 1
            if n % 500 == 0:
                print(f"{cls}: {n}/{len(ann)} images, {dict(taken)}")
            if args.max_per_class and main_label and taken[main_label] >= args.max_per_class:
                break

    landmarker.close()
    args.out.parent.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(
        args.out,
        world=np.array(worlds, dtype=np.float32),
        image=np.array(images, dtype=np.float32),
        handedness=np.array(handedness),
        label=np.array(labels),
        subject=np.array(subjects),
    )
    print(f"✔ {len(labels)} mains enregistrées dans {args.out}")
    print("Par classe :", dict(Counter(labels)))
    print("Statistiques :", dict(stats))


if __name__ == "__main__":
    main()

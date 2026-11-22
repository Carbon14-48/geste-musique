"""Prépare HaGRIDv2 pour le réseau HandNet, sans télécharger les images.

Les annotations HaGRIDv2 contiennent déjà les 21 points MediaPipe (x, y) de chaque main :
≈ 1 million de mains, des dizaines de milliers de personnes, séparées en train / val / test par personne.

    curl -LO https://rndml-team-cv.obs.ru-moscow-1.hc.sbercloud.ru/datasets/hagrid_v2/annotations_with_landmarks/annotations.zip
    unzip annotations.zip -d data/hagrid_v2
    python extract_hagrid_v2.py --annotations data/hagrid_v2/annotations --out data/hagrid_v2.npz

Sortie (.npz) : image (N, 21, 2), label, raw (classe HaGRID), subject (user_id), split.
"""

from __future__ import annotations

import argparse
import json
from collections import Counter
from pathlib import Path

import numpy as np

from common import HAGRID_V2_MAP


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--annotations", required=True, type=Path, help="dossier contenant train/, val/, test/")
    ap.add_argument("--out", required=True, type=Path)
    ap.add_argument("--max-per-class", type=int, default=12000, help="par classe HaGRID et par partie (0 = tout)")
    args = ap.parse_args()

    images, labels, raws, subjects, splits = [], [], [], [], []
    for split in ("train", "val", "test"):
        cap = args.max_per_class if split == "train" else max(args.max_per_class // 4, 0)
        taken = Counter()
        for f in sorted((args.annotations / split).glob("*.json")):
            ann = json.loads(f.read_text())
            for a in ann.values():
                for raw, lm in zip(a.get("labels", []), a.get("hand_landmarks", [])):
                    label = HAGRID_V2_MAP.get(raw)
                    if label is None or len(lm) != 21:
                        continue
                    if cap and taken[raw] >= cap:
                        continue
                    images.append(np.asarray(lm, dtype=np.float32)[:, :2])
                    labels.append(label)
                    raws.append(raw)
                    subjects.append(str(a.get("user_id") or "?"))
                    splits.append(split)
                    taken[raw] += 1
        print(f"{split}: {sum(taken.values())} mains", dict(sorted(taken.items())))

    args.out.parent.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(
        args.out,
        image=np.stack(images),
        label=np.array(labels),
        raw=np.array(raws),
        subject=np.array(subjects),
        split=np.array(splits),
    )
    print(f"✔ {len(labels)} mains dans {args.out} — par pose :", dict(Counter(labels)))


if __name__ == "__main__":
    main()

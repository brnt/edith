"""`python -m edith.sync (--seed S | --reference WAV | --template FILE:START:END) FILE...`

Prints how the files line up. The registration sound can be a seed, a WAV file, or an excerpt
of one of the recordings (e.g. `--template take.wav:13.38:13.62`).
"""

import argparse
import json
import sys
from dataclasses import asdict
from pathlib import Path

from edith.core.logging import configure_logging
from edith.sync.analyze import (
    DEFAULT_WINDOW_S,
    sync_files,
    template_from_audio,
    template_from_seed,
)


def _template(args: argparse.Namespace):
    if args.seed:
        return template_from_seed(args.seed)
    if args.reference:
        return template_from_audio(args.reference)
    path, start, end = args.template.rsplit(":", 2)
    return template_from_audio(
        Path(path), start_s=float(start), duration_s=float(end) - float(start)
    )


def main() -> int:
    parser = argparse.ArgumentParser(prog="python -m edith.sync")
    parser.add_argument("files", nargs="+", type=Path)
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--seed", help="seed the registration tone was generated from")
    source.add_argument(
        "--reference", type=Path, help="audio file containing the registration sound"
    )
    source.add_argument("--template", help="FILE:START:END excerpt of a recording, in seconds")
    parser.add_argument(
        "--window", type=float, default=DEFAULT_WINDOW_S, help="seconds searched at each end"
    )
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()

    configure_logging()
    result = sync_files(args.files, _template(args), args.window)
    if args.json:
        json.dump({k: asdict(v) for k, v in result.items()}, sys.stdout, indent=2)
        print()
        return 0
    for s in result.values():
        if s.start_s is None:
            print(f"{s.name:20} {s.status}")
            continue
        print(
            f"{s.name:20} {s.status:15} starts {s.start_s:8.3f}s  drift {s.drift_ppm:+8.1f} ppm  "
            f"tones {s.tone_start_s:.3f}/{s.tone_end_s:.3f}s  score {s.score:4.2f}  "
            f"interval residual {s.interval_residual_s * 1000:+.1f} ms"
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

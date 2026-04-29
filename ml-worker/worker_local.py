from __future__ import annotations

import runpy
from pathlib import Path


def main() -> None:
    # Небольшой wrapper для локального запуска из папки ml-worker.
    # Реальная логика worker'а лежит в extract-line-chart-data/worker_local.py.
    target = Path(__file__).resolve().parent / "extract-line-chart-data" / "worker_local.py"
    runpy.run_path(str(target), run_name="__main__")


if __name__ == "__main__":
    main()

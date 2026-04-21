import os
from pathlib import Path, PurePosixPath
from modal import App, Volume, Image

APP_NAME = "plextract" 
VOLUME_NAME = "plextract-vol"

modal_app = App(APP_NAME)
vol = Volume.from_name(VOLUME_NAME, create_if_missing=True)

base_cv_image = (
    Image.debian_slim(python_version="3.10")
    .apt_install("git")
    .apt_install("libgl1-mesa-glx", "libglib2.0-0")
    .run_commands("git clone https://github.com/tdsone/LineFormer.git")
    .pip_install(
        "openmim",
        "chardet",
        "transformers~=4.38.2",
        "bresenham",
        "tqdm",
        "torch==1.13.1",
        "torchvision==0.14.1",
    )
    .run_commands("mim install mmcv-full")
    .pip_install(
        "scikit-image",
        "matplotlib",
        "opencv-python",
        "pillow",
        "scipy==1.9.3",
    )
    .run_commands("pip install -e LineFormer/mmdetection")
)


def download_volume_dir(
    remote_dir: str,
    local_dir: str,
    volume_name: str = VOLUME_NAME,
) -> None:
    """
    Download all files under `remote_dir` inside the Modal Volume `volume_name`
    into the local directory `local_dir`, preserving subdirectory structure.

    - volume_name: name of the Modal Volume (as shown in `modal volume list`)
    - remote_dir: path inside the volume, e.g. "checkpoints/run-1" or "/"
    - local_dir: local destination directory
    """
    destination_root = Path(local_dir)
    destination_root.mkdir(parents=True, exist_ok=True)

    normalized_remote_dir = remote_dir.rstrip("/")
    if normalized_remote_dir == "":
        normalized_remote_dir = "/"

    remote_volume = vol if volume_name == VOLUME_NAME else Volume.from_name(volume_name, create_if_missing=False)

    entries = remote_volume.listdir(normalized_remote_dir, recursive=True)
    remote_root = PurePosixPath(normalized_remote_dir.lstrip("/")) if normalized_remote_dir != "/" else None

    downloaded_file_count = 0
    for entry in entries:
        entry_type = getattr(entry, "type", None)
        if getattr(entry_type, "name", str(entry_type)) != "FILE":
            continue

        remote_path = str(getattr(entry, "path", "")).strip()
        if not remote_path:
            continue

        remote_posix_path = PurePosixPath(remote_path.lstrip("/"))
        if remote_root is not None:
            try:
                relative_remote_path = remote_posix_path.relative_to(remote_root)
            except ValueError:
                continue
        else:
            relative_remote_path = remote_posix_path

        if not relative_remote_path.parts:
            continue

        destination_path = destination_root.joinpath(*relative_remote_path.parts)
        destination_path.parent.mkdir(parents=True, exist_ok=True)

        with destination_path.open("wb") as local_file:
            for chunk in remote_volume.read_file(remote_path):
                local_file.write(chunk)

        downloaded_file_count += 1

    if downloaded_file_count == 0:
        raise RuntimeError(
            f"Failed to download volume directory: no files found under {normalized_remote_dir} in volume {volume_name}"
        )

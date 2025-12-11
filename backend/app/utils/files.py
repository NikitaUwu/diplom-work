from pathlib import Path
from typing import Optional

from fastapi import UploadFile

from app.core.config import settings


def ensure_directory(path: Path) -> None:
    """
    Гарантирует существование директории (создаёт с parents=True).
    """
    path.mkdir(parents=True, exist_ok=True)


def get_user_root_dir(user_id: int) -> Path:
    """
    Корневая директория хранения для конкретного пользователя.
    Например: storage/user_1
    """
    return settings.storage_dir / f"user_{user_id}"


def get_originals_dir(user_id: int) -> Path:
    """
    Директория для исходных загруженных файлов.
    Например: storage/user_1/originals
    """
    root = get_user_root_dir(user_id)
    return root / "originals"


def get_previews_dir(user_id: int) -> Path:
    """
    Директория для превью (картинок с подсветкой линий и т.п.).
    Например: storage/user_1/previews
    """
    root = get_user_root_dir(user_id)
    return root / "previews"


def get_extension_from_filename(filename: str) -> str:
    """
    Возвращает расширение файла (с точкой), например: '.png', '.jpg'.
    Если расширения нет — возвращает пустую строку.
    """
    return Path(filename).suffix


def build_original_file_path(
    user_id: int,
    sha256: str,
    original_filename: str,
) -> Path:
    """
    Формирует путь для сохранения исходного файла.

    Стратегия: храним исходники по схеме
      storage/user_<id>/originals/<sha256><ext>

    Это позволяет:
      — складывать файлы в отдельные папки по пользователям,
      — избежать коллизий имён за счёт sha256.
    """
    originals_dir = get_originals_dir(user_id)
    ensure_directory(originals_dir)

    ext = get_extension_from_filename(original_filename)
    if not ext:
        # На всякий случай, если загрузили файл без расширения
        ext = ".bin"

    return originals_dir / f"{sha256}{ext}"


def build_preview_file_path(
    user_id: int,
    sha256: str,
    ext: str = ".png",
) -> Path:
    """
    Формирует путь для превью (например, PNG с подсветкой линий):

      storage/user_<id>/previews/<sha256>.png
    """
    previews_dir = get_previews_dir(user_id)
    ensure_directory(previews_dir)
    if not ext.startswith("."):
        ext = "." + ext
    return previews_dir / f"{sha256}{ext}"


def save_upload_file(upload: UploadFile, destination: Path) -> None:
    """
    Сохраняет содержимое UploadFile на диск по указанному пути.

    Предполагаем, что UploadFile открыт и готов к чтению.
    """
    ensure_directory(destination.parent)
    # Перематываем на начало — на всякий случай
    upload.file.seek(0)

    with destination.open("wb") as out_file:
        while True:
            chunk = upload.file.read(8192)
            if not chunk:
                break
            out_file.write(chunk)

    # После сохранения можно, при желании, вернуть курсор в начало
    upload.file.seek(0)


def save_bytes_to_file(data: bytes, destination: Path) -> None:
    """
    Сохранение уже прочитанных байт в файл.
    """
    ensure_directory(destination.parent)
    with destination.open("wb") as out_file:
        out_file.write(data)

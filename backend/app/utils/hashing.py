from hashlib import sha256
from typing import BinaryIO


def sha256_bytes(data: bytes) -> str:
    """
    Подсчёт sha256 для массива байт.
    """
    h = sha256()
    h.update(data)
    return h.hexdigest()


def sha256_fileobj(fileobj: BinaryIO, chunk_size: int = 8192) -> str:
    """
    Подсчёт sha256 для файлового объекта (например, UploadFile.file).

    ВАЖНО: вызывающий код сам отвечает за позицию курсора (seek(0) до и после).
    """
    h = sha256()
    while True:
        chunk = fileobj.read(chunk_size)
        if not chunk:
            break
        h.update(chunk)
    return h.hexdigest()

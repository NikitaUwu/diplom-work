from hashlib import sha256
from typing import BinaryIO


def sha256_bytes(data: bytes) -> str:
    h = sha256()
    h.update(data)
    return h.hexdigest()


def sha256_fileobj(fileobj: BinaryIO, chunk_size: int = 8192) -> str:
    if chunk_size <= 0:
        raise ValueError("chunk_size must be > 0")

    h = sha256()
    while True:
        chunk = fileobj.read(chunk_size)
        if not chunk:
            break
        if not isinstance(chunk, (bytes, bytearray, memoryview)):
            raise TypeError("fileobj must be opened in binary mode")
        h.update(chunk)
    return h.hexdigest()
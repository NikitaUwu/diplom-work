from .utils import logger


def _check_local_deps():
    """Check if local dependencies are installed."""
    try:
        import torch
        import transformers
        import cv2
        return True
    except ImportError:
        return False


def extract(
    input_dir: str = "input",
    output_dir: str = "output",
    backend: str = "local",
):
    if backend != "local":
        raise ValueError('Only backend="local" is supported in the current project setup.')

    if not _check_local_deps():
        raise ImportError(
            "Local dependencies not installed. "
            "Install the local ML worker requirements before running the pipeline."
        )

    logger.info("Running plextract locally...")
    from .local import run_pipeline
    run_pipeline(input_dir, output_dir)

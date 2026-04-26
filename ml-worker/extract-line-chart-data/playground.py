if __name__ == "__main__":
    from plextract import extract

    extract(input_dir="ml-worker\extract-line-chart-data\examples\input", output_dir="ml-worker\extract-line-chart-data\examples\output", backend="local")


    #python -m uvicorn app.main:app --app-dir backend
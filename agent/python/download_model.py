import sys
from sentence_transformers import SentenceTransformer


def main() -> None:
    print("Downloading intfloat/multilingual-e5-small...")
    try:
        SentenceTransformer("intfloat/multilingual-e5-small", device="cpu")
    except Exception as e:
        print(f"Failed to download model: {e}", file=sys.stderr)
        sys.exit(1)
    print("Done! Model cached at ~/.cache/huggingface/hub/")


if __name__ == "__main__":
    main()

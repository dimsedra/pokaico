import sys
import json
import numpy as np
from sentence_transformers import SentenceTransformer

model: SentenceTransformer | None = None
NORMALIZE = True

def load_model() -> None:
    global model
    model = SentenceTransformer("intfloat/multilingual-e5-small", device="cpu")
    model.eval()
    sys.stdout.write(json.dumps({"ready": True}) + "\n")
    sys.stdout.flush()

def embed_batch(texts: list[str]) -> list[list[float]]:
    assert model is not None
    embeddings = model.encode(texts, normalize_embeddings=NORMALIZE, show_progress_bar=False)
    return embeddings.tolist()

def handle_request(req: dict) -> dict:
    req_type = req.get("type")
    if req_type == "embed":
        texts = [req["text"]]
        result = embed_batch(texts)
        return {"id": req.get("id"), "type": "result", "data": result[0]}
    elif req_type == "embed_batch":
        texts = req["texts"]
        result = embed_batch(texts)
        return {"id": req.get("id"), "type": "result", "data": result}
    else:
        return {"id": req.get("id"), "type": "error", "message": f"Unknown type: {req_type}"}

def main() -> None:
    load_model()
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        req = None
        try:
            req = json.loads(line)
            resp = handle_request(req)
        except Exception as e:
            req_id = req.get("id") if isinstance(req, dict) else None
            resp = {"id": req_id, "type": "error", "message": str(e)}
        sys.stdout.write(json.dumps(resp) + "\n")
        sys.stdout.flush()

if __name__ == "__main__":
    main()

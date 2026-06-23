"""
Indexing Pipeline
-----------------
Loads course data from JSON, converts to LangChain Documents,
generates embeddings via Gemini, and upserts into Qdrant Cloud.

Usage:
    python -m app.core.index_data
"""

import sys
import time
import json
from pathlib import Path

# Add project root to path so we can import app modules
# index_data.py -> core -> app -> project_root
PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

from langchain_text_splitters import RecursiveCharacterTextSplitter
from app.core.document_loader import load_courses
from app.core.vectorstore import get_vector_store, get_qdrant_client
from app.config import settings

DATA_FILE = PROJECT_ROOT / "data" / "documents" / "all_courses.json"
PROGRESS_FILE = PROJECT_ROOT / "data" / ".index_progress.json"

# Each course entry is small, but we still split in case some are long
text_splitter = RecursiveCharacterTextSplitter(
    chunk_size=500,
    chunk_overlap=50,
    separators=["\n\n", "\n", " "],
)


def _load_progress() -> int:
    """Load the last successfully indexed chunk offset."""
    if PROGRESS_FILE.exists():
        data = json.loads(PROGRESS_FILE.read_text())
        return data.get("last_indexed", 0)
    return 0


def _save_progress(last_indexed: int):
    """Save progress so we can resume if interrupted."""
    PROGRESS_FILE.write_text(json.dumps({"last_indexed": last_indexed}))


def index_data(resume: bool = True):
    print(f"Loading courses from {DATA_FILE} ...")
    documents = load_courses(str(DATA_FILE))
    print(f"Loaded {len(documents)} course documents")

    # Split documents into chunks
    print("Splitting documents into chunks ...")
    chunks = text_splitter.split_documents(documents)
    print(f"Created {len(chunks)} chunks")

    # Resume support
    start_from = _load_progress() if resume else 0
    if start_from > 0:
        print(f"Resuming from chunk {start_from} (skipping already indexed)")

    # Index into Qdrant in batches (smaller batches + longer delay to respect free tier rate limits)
    # Free tier: 100 embed_content requests per minute
    print("Connecting to Qdrant Cloud & initializing vector store ...")
    vector_store = get_vector_store()

    batch_size = 10
    total = len(chunks)
    max_retries = 5
    print(f"Indexing {total - start_from} remaining chunks in batches of {batch_size} ...")

    for i in range(start_from, total, batch_size):
        batch = chunks[i : i + batch_size]
        retries = 0

        while retries < max_retries:
            try:
                vector_store.add_documents(batch)
                indexed = min(i + batch_size, total)
                _save_progress(indexed)
                print(f"  Indexed {indexed}/{total} chunks")
                break
            except Exception as e:
                err = str(e).lower()
                if "429" in err or "resource_exhausted" in err or "timeout" in err or "timed out" in err:
                    retries += 1
                    wait_time = 15 * retries  # 15s, 30s, 45s ...
                    reason = "Rate limited" if "429" in err or "resource_exhausted" in err else "Timeout"
                    print(f"  {reason}. Waiting {wait_time}s before retry ({retries}/{max_retries}) ...")
                    time.sleep(wait_time)
                else:
                    raise
        else:
            print(f"  Failed batch at index {i} after {max_retries} retries. Stopping.")
            print(f"  Progress saved. Run again to resume from chunk {i}.")
            return

        time.sleep(5)  # 5s delay between batches to stay under rate limit

    # Clean up progress file on completion
    if PROGRESS_FILE.exists():
        PROGRESS_FILE.unlink()
    print(f"\nDone! Successfully indexed {total} chunks into Qdrant collection.")


if __name__ == "__main__":
    index_data()

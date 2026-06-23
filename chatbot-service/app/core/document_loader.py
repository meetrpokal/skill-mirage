import json
from pathlib import Path
from langchain_core.documents import Document


def load_courses(file_path: str) -> list[Document]:
    """
    Load courses from the merged JSON file and convert each course
    into a LangChain Document with meaningful text content + metadata.
    """
    path = Path(file_path)
    with open(path, "r", encoding="utf-8") as f:
        courses = json.load(f)

    documents = []
    for course in courses:
        platform = course.get("platform", "Unknown")

        # Build readable text content for embedding
        parts = []
        if course.get("title"):
            parts.append(f"Title: {course['title']}")
        if course.get("discipline"):
            parts.append(f"Discipline: {course['discipline']}")
        if course.get("category"):
            cats = course["category"] if isinstance(course["category"], list) else [course["category"]]
            parts.append(f"Category: {', '.join(cats)}")
        if course.get("instructor"):
            parts.append(f"Instructor: {course['instructor']}")
        if course.get("institute"):
            parts.append(f"Institute: {course['institute']}")
        if course.get("language"):
            parts.append(f"Language: {course['language']}")
        if course.get("open_for_registration") is not None:
            status = "Open" if course["open_for_registration"] else "Closed"
            parts.append(f"Registration: {status}")
        parts.append(f"Platform: {platform}")
        if course.get("link"):
            parts.append(f"Link: {course['link']}")

        page_content = "\n".join(parts)

        # Store raw fields as metadata for filtering/retrieval
        metadata = {
            "title": course.get("title", ""),
            "platform": platform,
            "instructor": course.get("instructor", ""),
            "institute": course.get("institute", ""),
            "link": course.get("link", ""),
        }
        if course.get("discipline"):
            metadata["discipline"] = course["discipline"]
        if course.get("category"):
            metadata["category"] = ", ".join(course["category"]) if isinstance(course["category"], list) else course["category"]
        if course.get("language"):
            metadata["language"] = course["language"]

        documents.append(Document(page_content=page_content, metadata=metadata))

    return documents

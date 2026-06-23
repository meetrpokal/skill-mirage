import requests
import json

URL = "https://swayam.gov.in/explorer"


def scrape_swayam_courses():
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
    }
    response = requests.get(URL, headers=headers)
    text = response.text

    # Course data is embedded as JSON in a Polymer web component property
    idx = text.find('"edges"')
    if idx == -1:
        print("Could not find course data in page. Page structure may have changed.")
        return

    start = text.rfind("{", 0, idx)
    decoder = json.JSONDecoder()
    data, _ = decoder.raw_decode(text, start)
    edges = data.get("edges", [])
    print(f"Found {len(edges)} courses from embedded JSON")

    courses = []
    for edge in edges:
        node = edge.get("node", {})
        category = node.get("category") or []
        cat_names = [c.get("name") for c in category if isinstance(c, dict) and c.get("name")] if isinstance(category, list) else ([category.get("name")] if isinstance(category, dict) and category.get("name") else [])

        course = {
            "title": node.get("title"),
            "instructor": node.get("explorerInstructorName"),
            "institute": node.get("ncName"),
            "category": cat_names if cat_names else None,
            "link": node.get("url"),
            "language": node.get("courseLanguage"),
            "open_for_registration": node.get("openForRegistration"),
            "platform": "SWAYAM"
        }
        courses.append(course)

    with open("documents/swayam_courses.json", "w", encoding="utf-8") as f:
        json.dump(courses, f, indent=4, ensure_ascii=False)

    print(f"Saved {len(courses)} courses")


if __name__ == "__main__":
    scrape_swayam_courses()
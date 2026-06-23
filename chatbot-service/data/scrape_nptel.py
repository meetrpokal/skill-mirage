import requests
from bs4 import BeautifulSoup
import json

BASE_URL = "https://nptel.ac.in"

def scrape_nptel_courses():
    url = f"{BASE_URL}/courses"
    response = requests.get(url)

    soup = BeautifulSoup(response.text, "html.parser")

    courses = []

    course_cards = soup.select(".course-card")
    print(f"Found {len(course_cards)} course cards")

    for card in course_cards:
        title = card.select_one(".name")
        discipline = card.select_one(".discipline")
        meta_spans = card.select(".meta-data span")
        link = card.select_one("a")

        course = {
            "title": title.text.strip() if title else None,
            "discipline": discipline.text.strip() if discipline else None,
            "instructor": meta_spans[0].text.strip() if len(meta_spans) > 0 else None,
            "institute": meta_spans[1].text.strip() if len(meta_spans) > 1 else None,
            "link": BASE_URL + link["href"] if link else None,
            "platform": "NPTEL"
        }

        courses.append(course)

    with open("documents/nptel_courses.json", "w", encoding="utf-8") as f:
        json.dump(courses, f, indent=4, ensure_ascii=False)

    print(f"Saved {len(courses)} courses")


if __name__ == "__main__":
    scrape_nptel_courses()
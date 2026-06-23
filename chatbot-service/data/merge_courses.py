import json

with open("documents/nptel_courses.json", encoding="utf-8") as f:
    nptel = json.load(f)

with open("documents/swayam_courses.json", encoding="utf-8") as f:
    swayam = json.load(f)

all_courses = nptel + swayam

with open("documents/all_courses.json", "w", encoding="utf-8") as f:
    json.dump(all_courses, f, indent=4)

print("Merged dataset created")
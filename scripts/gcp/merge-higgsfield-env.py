"""Keep the newer Higgsfield login when a deploy uploads worker.env."""
import os
import re
import sys

vm_path, new_path = sys.argv[1], sys.argv[2]
KEYS = (
    "HIGGSFIELD_CLIENT_ID",
    "HIGGSFIELD_CLIENT_SECRET",
    "HIGGSFIELD_REFRESH_TOKEN",
    "HIGGSFIELD_TOKEN_UPDATED_AT",
)


def read(path: str) -> tuple[str, dict[str, str]]:
    text = open(path).read()
    vals: dict[str, str] = {}
    for line in text.splitlines():
        if "=" in line and not line.startswith("#"):
            key, value = line.split("=", 1)
            vals[key] = value
    return text, vals


def stamp(vals: dict[str, str], path: str) -> int:
    raw = vals.get("HIGGSFIELD_TOKEN_UPDATED_AT", "")
    if raw.isdigit():
        return int(raw)
    return int(os.path.getmtime(path) * 1000)


def main() -> None:
    if not os.path.exists(vm_path) or not os.path.exists(new_path):
        return
    _vm_text, vm = read(vm_path)
    new_text, fresh = read(new_path)
    if not vm.get("HIGGSFIELD_REFRESH_TOKEN"):
        return
    if stamp(vm, vm_path) <= stamp(fresh, new_path):
        return
    text = new_text
    for key in KEYS:
        if key not in vm:
            continue
        line = f"{key}={vm[key]}"
        pattern = re.compile(rf"^#?\s*{key}=.*$", re.M)
        text = pattern.sub(line, text) if pattern.search(text) else text.rstrip() + "\n" + line + "\n"
    with open(new_path, "w") as handle:
        handle.write(text if text.endswith("\n") else text + "\n")
    print("kept newer Higgsfield login already on the VM")


if __name__ == "__main__":
    main()

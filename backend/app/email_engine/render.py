import html
import re

PATTERN = re.compile(r"{{\s*([a-zA-Z0-9_]+)\s*}}")


def personalize(text, recipient, escape=False):
    values = {
        **recipient.custom_fields,
        "name": recipient.name,
        "email": recipient.email,
        "company": recipient.company,
        "position": recipient.position,
    }

    def replace(match):
        key = match.group(1)
        if key not in values:
            raise ValueError(f"Missing personalization field: {key}")
        value = str(values[key])
        return html.escape(value) if escape else value.replace("\r", " ").replace("\n", " ")

    return PATTERN.sub(replace, text)

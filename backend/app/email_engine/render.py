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
        if key not in values or values[key] in (None, ""):
            label = key.replace("_", " ")
            raise ValueError(
                f"Some selected recipients are missing “{label}”. Add it for every recipient, "
                f"or remove {{{{{key}}}}} from the email before sending."
            )
        value = str(values[key])
        return html.escape(value) if escape else value.replace("\r", " ").replace("\n", " ")

    return PATTERN.sub(replace, text)

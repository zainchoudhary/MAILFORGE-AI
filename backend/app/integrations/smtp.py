import ipaddress
import socket
import ssl
import smtplib
from email.message import EmailMessage
from pathlib import Path
from app.core.config import get_settings
from app.security.auth import decrypt


def validate_host(host):
    if get_settings().allow_private_smtp:
        return
    for entry in socket.getaddrinfo(host, None):
        if not ipaddress.ip_address(entry[4][0]).is_global:
            raise ValueError("Private SMTP hosts are disabled")


def connect(account):
    validate_host(account.host)
    context = ssl.create_default_context()
    if account.security == "ssl":
        client = smtplib.SMTP_SSL(
            account.host, account.port, timeout=get_settings().smtp_timeout, context=context
        )
    else:
        client = smtplib.SMTP(account.host, account.port, timeout=get_settings().smtp_timeout)
        client.ehlo()
        client.starttls(context=context)
        client.ehlo()
    if account.username:
        client.login(account.username, decrypt(account.encrypted_password))
    return client


def build_message(message, campaign, account, documents):
    import bleach

    mail = EmailMessage()
    mail["Subject"] = message.subject
    mail["From"] = account.from_email
    mail["To"] = message.recipient_email
    if campaign.cc:
        mail["Cc"] = ", ".join(campaign.cc)
    mail["Message-ID"] = f"<{message.id}@mailforge.local>"
    body = message.body
    mail.set_content(bleach.clean(body, tags=[], strip=True))
    mail.add_alternative(body, subtype="html")
    for doc in documents:
        main, sub = doc.mime_type.split("/", 1)
        mail.add_attachment(
            (Path(get_settings().storage_path) / doc.storage_key).read_bytes(),
            maintype=main,
            subtype=sub,
            filename=doc.filename,
        )
    return mail


def send(message, campaign, account, documents):
    mail = build_message(message, campaign, account, documents)
    with connect(account) as client:
        rejected = client.send_message(
            mail, to_addrs=[message.recipient_email, *campaign.cc, *campaign.bcc]
        )
    if message.recipient_email in rejected:
        code, response = rejected[message.recipient_email]
        raise smtplib.SMTPResponseException(code, response)
    return "SMTP accepted primary recipient; not confirmed inbox delivery" + (
        "; some CC/BCC recipients rejected" if rejected else ""
    )

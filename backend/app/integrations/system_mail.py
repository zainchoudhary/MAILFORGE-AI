"""Official Outreach Studio mailer for app-owned notifications only."""
import smtplib
import ssl
from email.message import EmailMessage

from app.core.config import get_settings


def send_system_mail(recipient, subject, text, html):
    settings = get_settings()
    if not all((settings.system_mail_host, settings.system_mail_username, settings.system_mail_password, settings.system_mail_from)):
        raise RuntimeError("Official system mailer is not configured")
    message = EmailMessage()
    message["Subject"] = subject
    message["From"] = settings.system_mail_from
    message["To"] = recipient
    message.set_content(text)
    message.add_alternative(html, subtype="html")
    context = ssl.create_default_context()
    if settings.system_mail_security == "ssl":
        client = smtplib.SMTP_SSL(settings.system_mail_host, settings.system_mail_port, timeout=settings.smtp_timeout, context=context)
    else:
        client = smtplib.SMTP(settings.system_mail_host, settings.system_mail_port, timeout=settings.smtp_timeout)
        client.ehlo()
        client.starttls(context=context)
        client.ehlo()
    with client:
        client.login(settings.system_mail_username, settings.system_mail_password)
        client.send_message(message)

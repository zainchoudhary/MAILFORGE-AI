import smtplib
from types import SimpleNamespace
from email import policy
from email.parser import BytesParser
from aiosmtpd.controller import Controller
from app.integrations.smtp import build_message


class Handler:
    messages = []

    async def handle_DATA(self, server, session, envelope):
        self.messages.append(envelope.content)
        return "250 Message accepted for testing"


def test_real_smtp_transport_keeps_bcc_out_of_headers():
    handler = Handler()
    handler.messages = []
    controller = Controller(handler, hostname="127.0.0.1", port=58025)
    controller.start()
    try:
        message = SimpleNamespace(
            id="test-message",
            subject="Hello",
            body="<p>Hello Alex</p>",
            recipient_email="alex@example.com",
        )
        campaign = SimpleNamespace(cc=["cc@example.com"], bcc=["secret@example.com"])
        account = SimpleNamespace(from_email="sender@example.com")
        mail = build_message(message, campaign, account, [], "https://example.com/unsubscribe")
        with smtplib.SMTP("127.0.0.1", 58025) as client:
            rejected = client.send_message(
                mail, to_addrs=[message.recipient_email, *campaign.cc, *campaign.bcc]
            )
        assert rejected == {}
        parsed = BytesParser(policy=policy.default).parsebytes(handler.messages[0])
        assert parsed["Bcc"] is None
        assert parsed["List-Unsubscribe"]
        assert parsed["Message-ID"] == "<test-message@mailforge.local>"
    finally:
        controller.stop()

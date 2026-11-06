import httpx
import pytest
from unittest.mock import patch

from app.core.config import get_settings
from app.lead_finder.fetch import fetch_page_text
from app.lead_finder.search import LeadSearchConfigError, SearchHit, search_web


@pytest.fixture(autouse=True)
def _restore_lead_settings():
    """get_settings() is lru_cached; put provider fields back after each test."""
    get_settings.cache_clear()
    before = get_settings()
    snapshot = {
        "lead_search_provider": before.lead_search_provider,
        "serper_api_key": before.serper_api_key,
        "google_cse_api_key": before.google_cse_api_key,
        "google_cse_cx": before.google_cse_cx,
        "lead_finder_fetch_timeout": before.lead_finder_fetch_timeout,
        "lead_finder_max_page_bytes": before.lead_finder_max_page_bytes,
        "lead_finder_allow_private_fetch": before.lead_finder_allow_private_fetch,
    }
    yield
    current = get_settings()
    for key, value in snapshot.items():
        setattr(current, key, value)


def test_search_requires_key(monkeypatch):
    get_settings.cache_clear()
    monkeypatch.setenv("SERPER_API_KEY", "")
    get_settings.cache_clear()
    settings = get_settings()
    settings.serper_api_key = ""
    settings.lead_search_provider = "serper"
    try:
        search_web("recruiter london")
        assert False, "expected config error"
    except LeadSearchConfigError as err:
        assert "SERPER_API_KEY" in str(err)


def test_google_cse_requires_key_and_cx():
    settings = get_settings()
    settings.lead_search_provider = "google_cse"
    settings.google_cse_api_key = ""
    settings.google_cse_cx = "engine"
    with pytest.raises(LeadSearchConfigError) as err:
        search_web("recruiter london")
    message = str(err.value)
    assert "GOOGLE_CSE_API_KEY" in message
    assert "GOOGLE_CSE_CX" in message

    settings.google_cse_api_key = "key"
    settings.google_cse_cx = ""
    with pytest.raises(LeadSearchConfigError) as missing_cx:
        search_web("recruiter london")
    assert "GOOGLE_CSE_CX" in str(missing_cx.value)


def test_unknown_provider_is_rejected():
    settings = get_settings()
    settings.lead_search_provider = "bing"
    settings.serper_api_key = "present"
    with pytest.raises(LeadSearchConfigError) as err:
        search_web("recruiter london")
    assert "LEAD_SEARCH_PROVIDER" in str(err.value)


def test_serper_maps_organic_http_results():
    settings = get_settings()
    settings.lead_search_provider = "serper"
    settings.serper_api_key = "serper-secret"
    settings.lead_finder_fetch_timeout = 9
    response = httpx.Response(
        200,
        json={
            "organic": [
                {
                    "title": "Acme Team",
                    "link": "https://acme.test/team",
                    "snippet": "Jane Recruiter",
                },
                {"title": "Files", "link": "ftp://files.test/a", "snippet": "skip"},
                {"title": "Script", "link": "javascript:alert(1)", "snippet": "skip"},
                {"title": "Plain", "link": "http://plain.test/jobs", "snippet": "Hiring"},
                {"title": "No link", "snippet": "missing"},
            ]
        },
        request=httpx.Request("POST", "https://google.serper.dev/search"),
    )
    with patch("app.lead_finder.search.httpx.Client") as client_cls:
        client = client_cls.return_value.__enter__.return_value
        client.post.return_value = response
        hits = search_web("recruiter london", num=7)

    assert hits == [
        SearchHit("Acme Team", "https://acme.test/team", "Jane Recruiter"),
        SearchHit("Plain", "http://plain.test/jobs", "Hiring"),
    ]
    assert client_cls.call_args.kwargs["timeout"] == 9
    client.post.assert_called_once()
    url, = client.post.call_args.args
    posted = client.post.call_args.kwargs
    assert url == "https://google.serper.dev/search"
    assert posted["headers"]["X-API-KEY"] == "serper-secret"
    assert posted["json"] == {"q": "recruiter london", "num": 7}


def test_google_cse_maps_items():
    settings = get_settings()
    settings.lead_search_provider = "Google_CSE"
    settings.google_cse_api_key = "gkey"
    settings.google_cse_cx = "gcx"
    response = httpx.Response(
        200,
        json={
            "items": [
                {"title": "Beta", "link": "https://beta.test/a", "snippet": "TA lead"},
                {"title": "Mail", "link": "mailto:a@b.test", "snippet": "skip"},
            ]
        },
        request=httpx.Request("GET", "https://www.googleapis.com/customsearch/v1"),
    )
    with patch("app.lead_finder.search.httpx.Client") as client_cls:
        client = client_cls.return_value.__enter__.return_value
        client.get.return_value = response
        hits = search_web("fintech recruiter", num=5)

    assert hits == [SearchHit("Beta", "https://beta.test/a", "TA lead")]
    url, = client.get.call_args.args
    params = client.get.call_args.kwargs["params"]
    assert url == "https://www.googleapis.com/customsearch/v1"
    assert params["key"] == "gkey"
    assert params["cx"] == "gcx"
    assert params["q"] == "fintech recruiter"
    assert params["num"] == 5


def test_serper_http_error_propagates():
    settings = get_settings()
    settings.lead_search_provider = "serper"
    settings.serper_api_key = "serper-secret"
    response = httpx.Response(
        429,
        json={"message": "rate limit"},
        request=httpx.Request("POST", "https://google.serper.dev/search"),
    )
    with patch("app.lead_finder.search.httpx.Client") as client_cls:
        client = client_cls.return_value.__enter__.return_value
        client.post.return_value = response
        with pytest.raises(httpx.HTTPStatusError):
            search_web("recruiter london")


PUBLIC_IPS = {"acme.test": "93.184.216.34", "other.test": "93.184.216.35"}


@pytest.fixture
def web(monkeypatch):
    """Route fetches through a MockTransport and resolve test hosts without real DNS."""
    state = {"handler": None, "client_kwargs": None}

    def fake_getaddrinfo(host, port, *a, **k):
        ip = PUBLIC_IPS.get(host, host)
        return [(2, 1, 6, "", (ip, port or 0))]

    def fake_client(timeout):
        state["client_kwargs"] = {"timeout": timeout}
        return httpx.Client(
            transport=httpx.MockTransport(lambda request: state["handler"](request)),
            timeout=timeout,
            follow_redirects=False,
        )

    monkeypatch.setattr("app.lead_finder.fetch.socket.getaddrinfo", fake_getaddrinfo)
    monkeypatch.setattr("app.lead_finder.fetch._client", fake_client)
    return state


def _html(body, status=200, headers=None):
    return httpx.Response(
        status, content=body, headers={"content-type": "text/html; charset=utf-8", **(headers or {})}
    )


def test_fetch_returns_none_on_error(web):
    def boom(request):
        raise httpx.TimeoutException("timeout", request=request)

    web["handler"] = boom
    assert fetch_page_text("https://acme.test/") is None


def test_fetch_strips_script_style_and_tags(web):
    html = b"""
    <html><head><style>body { color: red }</style>
    <script>var secret = "hidden@acme.com";</script></head>
    <body><h1>Team</h1><p>Jane Doe Recruiter jane.doe@acme.com</p></body></html>
    """
    web["handler"] = lambda request: _html(html)
    text = fetch_page_text("https://acme.test/team")
    assert text is not None
    assert "hidden@acme.com" not in text
    assert "color" not in text
    assert "Jane Doe Recruiter" in text
    assert "jane.doe@acme.com" in text
    assert "<" not in text


def test_fetch_returns_none_on_non_2xx(web):
    web["handler"] = lambda request: _html(b"<p>missing</p>", status=404)
    assert fetch_page_text("https://acme.test/missing") is None


def test_fetch_caps_streamed_bytes_and_uses_timeout(web):
    settings = get_settings()
    settings.lead_finder_fetch_timeout = 7
    settings.lead_finder_max_page_bytes = 20
    chunks_sent = []

    def chunks():
        for part in (b"<p>ABCDEFGHIJKLMNOP", b"QRSTUVWXYZ jane@acme.com</p>", b"x" * 10_000):
            chunks_sent.append(part)
            yield part

    web["handler"] = lambda request: httpx.Response(
        200, headers={"content-type": "text/html"}, content=chunks()
    )
    text = fetch_page_text("https://acme.test/big")
    assert text is not None
    assert "jane@acme.com" not in text
    assert "ABCDEFGHIJKLMNOP" in text
    assert web["client_kwargs"]["timeout"] == 7
    assert len(chunks_sent) == 2  # stopped streaming once the cap was reached


def test_fetch_wall_clock_deadline(web, monkeypatch):
    ticks = {"n": 0}

    def clock():
        ticks["n"] += 1
        return ticks["n"] * 100.0  # each call jumps well past the 15s budget

    monkeypatch.setattr("app.lead_finder.fetch.time.monotonic", clock)
    web["handler"] = lambda request: httpx.Response(
        200, headers={"content-type": "text/html"}, content=iter([b"<p>a</p>", b"<p>b</p>"])
    )
    assert fetch_page_text("https://acme.test/slow") is None


def test_fetch_rejects_non_text_content_type(web):
    web["handler"] = lambda request: httpx.Response(
        200, headers={"content-type": "application/pdf"}, content=b"%PDF jane@acme.test"
    )
    assert fetch_page_text("https://acme.test/file.pdf") is None


def test_fetch_follows_public_redirects_manually(web):
    seen = []

    def handler(request):
        seen.append(str(request.url))
        if request.url.host == "acme.test":
            return httpx.Response(302, headers={"location": "https://other.test/team"})
        return _html(b"<p>Jane jane@other.test</p>")

    web["handler"] = handler
    assert "jane@other.test" in fetch_page_text("https://acme.test/team")
    assert seen == ["https://acme.test/team", "https://other.test/team"]


def test_fetch_refuses_redirect_to_private_ip(web):
    seen = []

    def handler(request):
        seen.append(request.url.host)
        if request.url.host == "acme.test":
            return httpx.Response(302, headers={"location": "http://169.254.169.254/latest/meta-data"})
        return _html(b"secret")

    web["handler"] = handler
    assert fetch_page_text("https://acme.test/team") is None
    assert seen == ["acme.test"]


@pytest.mark.parametrize(
    "url",
    ["http://127.0.0.1/", "http://10.0.0.5/admin", "http://[::1]/", "ftp://acme.test/x", "file:///etc/passwd"],
)
def test_fetch_refuses_private_and_non_http(web, url):
    web["handler"] = lambda request: pytest.fail("must not send a request")
    assert fetch_page_text(url) is None


def test_fetch_private_allowed_when_setting_on(web):
    get_settings().lead_finder_allow_private_fetch = True
    web["handler"] = lambda request: _html(b"<p>local</p>")
    assert fetch_page_text("http://127.0.0.1/") == "local"


def test_fetch_stops_after_too_many_redirects(web):
    calls = []

    def handler(request):
        calls.append(1)
        return httpx.Response(302, headers={"location": f"https://acme.test/r{len(calls)}"})

    web["handler"] = handler
    assert fetch_page_text("https://acme.test/r0") is None
    assert len(calls) == 6

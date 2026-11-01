# MAILFORGE AI — Aasaan Guide

Ye website emails ko **organize**, **likhne**, **bhejne se pehle check karne**, aur unka result dekhne ke liye bani hai.

Isko aap aise samjhein:

> Aap file upload karte hain → website emails nikalti hai → aap check karte hain → email likhte hain → test karte hain → phir approval ke baad email bhejte hain.

Website abhi **safe testing mode** mein hai. Iska matlab: aap practice, drafts aur preview bana sakte hain, lekin real email automatically send nahi hogi.

---

## Sab se pehle kya karna hai?

1. Browser mein website kholen: `http://127.0.0.1:5173`
2. **Create workspace** par click karein.
3. Apna naam, company/organization ka naam, email aur password dalein.
4. Account banne ke baad aap dashboard mein aa jayenge.

---

## Website ka simple flow

```text
Document upload karo
        ↓
Emails aur names check karo
        ↓
Recipients save karo aur consent note karo
        ↓
Email campaign banao
        ↓
Preview + dry run karo
        ↓
Approval do
        ↓
Email activity aur reports dekho
```

---

# Har page ka maqsad

## 1. Overview Dashboard

**Ye home page hai.**

Yahan aapko short summary milti hai:

- Kitne campaigns banaye hain.
- Kitne recipients hain.
- Kitni emails SMTP server ne accept ki hain.
- Kitni delivery provider ne confirm ki hain.
- Recent campaigns.
- Email activity ka graph.

**Kab use karna hai?**

Jab aap bas ye dekhna chahein ke overall kaam kaisa chal raha hai.

---

## 2. AI Agent Studio

**Ye AI se help lene wala page hai.**

Yahan aap normal language mein likh sakte hain, jaise:

> "Mujhe partnership ke liye professional email prepare karni hai."

AI aapki help karta hai:

- Email ka draft banane mein.
- Campaign ka plan samajhne mein.
- Failed emails ka reason samajhne mein.
- Analytics ka summary dene mein.

**Important:** AI khud real email send nahi kar sakta. Final review aur approval aapke haath mein rehti hai.

---

## 3. Compose Email

**Yahan aap new email campaign banate hain.**

Is page mein:

- Campaign ka naam likhein. Example: `October Clients Follow-up`
- Recipients select karein.
- Subject likhein. Example: `A quick update for you`
- Email ka message likhein.
- File attach karein, agar zaroori ho.
- AI Writing Copilot se email improve karwa sakte hain.
- Preview dekh sakte hain.
- Draft save kar sakte hain.

### Personalization kya hai?

Aap email mein ye likh sakte hain:

```text
Hello {{name}},
```

Jis recipient ka naam Ali hoga, usko email mein `Hello Ali` nazar aayega.

Useful fields:

- `{{name}}` — person ka naam
- `{{email}}` — person ka email
- `{{company}}` — company ka naam
- `{{position}}` — job title

**Kab use karna hai?**

Jab aap manually email/campaign banana chahte hain.

---

## 4. Document Intelligence

**Yahan aap files upload karke emails nikalte hain.**

Supported files:

- PDF
- Word file
- Excel file
- CSV
- Text file
- Image / scanned document

### Use ka tareeqa

1. File upload karein.
2. **Extract** button click karein.
3. Website file se email addresses, names aur companies dhoondhegi.
4. Aap table mein har record check karein.
5. Galat entry remove ya edit karein.
6. Sirf sahi log select karein.
7. **Save reviewed recipients** click karein.

**Important:** File mein email mil jane ka matlab ye nahi ke us person ko email bhejni chahiye. Aapko pehle manually review karna zaroori hai.

---

## 5. Campaigns

**Yahan aapke sab email campaigns milte hain.**

Campaign ka matlab: aik email message jo selected logon ko bhejna ho.

Har campaign mein aap dekh sakte hain:

- Campaign ka naam
- Status
- Selected recipients
- Email ka message
- Attachments
- Sending progress
- Failures

### Campaign ke important steps

1. **Review recipients** — confirm karein ke sahi log select hain.
2. **Dry run** — check karein email kaisi lagegi. Is mein real email send nahi hoti.
3. **Approve campaign** — real sending ke liye final permission.

### Status ka matlab

| Status | Simple matlab |
|---|---|
| Draft | Abhi ban rahi hai, send nahi hui. |
| Scheduled | Future date/time par bhejne ke liye ready hai. |
| Processing / Sending | System email process kar raha hai. |
| SMTP Accepted | Email sending server ne accept kar li. Iska matlab inbox mein zaroor pohanch gayi, ye confirm nahi hota. |
| Completed | Campaign ka kaam complete ho gaya. |
| Failed | Koi error aaya. |
| Paused | Campaign temporary ruk gayi. |
| Cancelled | Campaign band kar di gayi. |

**Kab use karna hai?**

Jab campaign ko review, test, pause, resume, cancel, ya report download karni ho.

---

## 6. Email Activity

**Yahan har individual email ka record hota hai.**

Yahan aap dekh sakte hain:

- Kis person ko email gayi.
- Subject kya tha.
- Status kya hai.
- Kitni dafa send try hui.
- Error kya aaya.
- SMTP response kya tha.
- Attached files kya the.

Kisi row par click karke complete email detail dekh sakte hain.

**Kab use karna hai?**

Jab aapko kisi aik specific email ka issue dekhna ho.

---

## 7. Recipients

**Yahan aapke contacts / email recipients save hote hain.**

Yahan aap:

- New recipient manually add kar sakte hain.
- Name, email, company aur position add kar sakte hain.
- Existing recipient edit kar sakte hain.
- Consent record kar sakte hain.
- Recipient remove kar sakte hain.

### Consent kya hai?

Consent ka matlab hai: aapke paas koi real reason ya permission ho ke aap us person ko email kar sakte hain.

Example note:

```text
Client ne website form mein partnership updates ke liye permission di thi.
```

**Important:** Production email send karne ke liye recipient ka consent hona zaroori hai.

---

## 8. Templates

**Yahan reusable email messages save hote hain.**

Example templates:

- New client introduction
- Partnership request
- Follow-up message
- Invoice reminder
- Meeting request

Har dafa email zero se likhne ke bajaye, template choose karein aur customize karein.

**Kab use karna hai?**

Jab aap same type ki email baar baar bhejte hain.

---

## 9. Analytics

**Yahan performance reports aur charts hote hain.**

Yahan aap dekh sakte hain:

- Total processed emails
- SMTP accepted emails
- Confirmed deliveries
- Failed emails
- Pending emails
- Campaign comparison
- Recent failures

**Important:** `SMTP Accepted` ka matlab sirf itna hai ke SMTP server ne message accept kiya. Isko inbox delivery confirmation na samjhein.

**Kab use karna hai?**

Jab aapko reporting ya performance check karni ho.

---

## 10. Automation

**Yahan scheduled aur active campaigns ki list hoti hai.**

Agar aapne campaign future time ke liye schedule ki hai, woh yahan show hogi.

**Kab use karna hai?**

Jab aapko dekhna ho ke kaunsi campaign kab chalegi ya abhi sending mein hai.

---

## 11. SMTP Settings

**Yahan aap sending email account connect karte hain.**

SMTP ka simple matlab: woh setting jo website ko batati hai email kis account se send karni hai.

Gmail ke liye aam tor par:

```text
Host: smtp.gmail.com
Port: 587
Security: STARTTLS
```

Gmail password ke bajaye **Gmail App Password** use karein.

### Is page par kya karna hai?

1. **Add SMTP account** click karein.
2. Apni SMTP details fill karein.
3. Save karein.
4. **Test connection** click karein.

**Important:** Password frontend mein show nahi hota. Secure tarike se server par save hota hai.

---

## 12. Integrations

**Yahan system ke connected services ka status show hota hai.**

Example:

- AI provider configured hai ya nahi.
- SMTP configured hai ya nahi.
- Malware scanner configured hai ya nahi.

**Kab use karna hai?**

Jab kisi feature kaam nahi kar raha ho aur aap configuration status check karna chahte hon.

---

## 13. Audit Logs

**Yahan important actions ki history save hoti hai.**

Example:

- Kis ne campaign banayi.
- Kis ne recipient edit kiya.
- Kis ne SMTP test kiya.
- Kis ne campaign approve ki.

**Kab use karna hai?**

Jab aapko dekhna ho ke workspace mein kis ne kya action kiya.

---

## 14. Settings

**Yahan workspace preferences aur safety settings ka summary hota hai.**

Yahan aap:

- Timezone set kar sakte hain.
- Compact tables on/off kar sakte hain.
- Suppression list manage kar sakte hain.
- Safe sending limits dekh sakte hain.

### Suppression list kya hai?

Aisi email addresses ki list jinhen kabhi email nahi bhejni chahiye.

Example:

- Person ne unsubscribe kiya.
- Email bounce hui.
- Person ne clearly mana kiya.

---

# Aapka pehla practical example

Maan lein aapke paas Excel file hai jisme clients ke emails hain.

1. **Document Intelligence** par jaayein.
2. Excel file upload karein.
3. **Extract** click karein.
4. Emails ko check karein aur sahi recipients save karein.
5. **Recipients** page par jaa kar real consent note karein.
6. **Compose Email** page kholen.
7. Recipients select karein.
8. Subject aur message likhein.
9. **Save draft** karein.
10. **Campaigns** page par jaa kar recipient review aur dry run karein.

Abhi website safe testing mode mein hai, isliye real email send nahi hogi. Ye achi baat hai, kyun ke pehle aap araam se workflow samajh sakte hain.

---

# Agar koi error aaye to kya karein?

| Error / problem | Kya karein |
|---|---|
| `Not authenticated` | Login karein ya browser refresh karein. |
| `Request failed` | Backend running hai ya nahi check karein. |
| AI response nahi aa raha | AI API key configured nahi ho sakti. Normal composing phir bhi kaam karegi. |
| Email send nahi ho rahi | Safe testing mode on hai ya SMTP account set nahi hai. |
| Recipient cannot be approved | Consent add karein aur suppression list check karein. |
| File extract nahi ho rahi | File format aur size check karein. |

---

# Important safety baatein

- Kisi ko email bhejne se pehle recipient list zaroor check karein.
- Consent ke baghair marketing/bulk email na bhejein.
- `SMTP Accepted` ko delivery confirmation na samjhein.
- Real sending start karne se pehle SMTP test karein.
- Pehle dry run karein, phir hi campaign approve karein.

---

## Sab se short summary

| Aap kya karna chahte hain? | Kaunsa page use karein? |
|---|---|
| File se emails nikalni hain | Document Intelligence |
| Contacts manage karne hain | Recipients |
| Email likhni hai | Compose Email |
| AI se help leni hai | AI Agent Studio |
| Campaign test/approve karni hai | Campaigns |
| Individual email ka status dekhna hai | Email Activity |
| Report/charts dekhne hain | Analytics |
| Sending account connect karna hai | SMTP Settings |
| Purani actions dekhni hain | Audit Logs |
| Unsubscribe/bounce list manage karni hai | Settings |

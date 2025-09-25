import os
import json
from dotenv import load_dotenv
from pydantic import BaseModel, Field
from langchain_google_genai import ChatGoogleGenerativeAI
from langchain_core.messages import HumanMessage, SystemMessage
from langchain.output_parsers import PydanticOutputParser

load_dotenv()

# ----- Schemas -----
class GeminiScoreResponse(BaseModel):
    SCORE: int = Field(..., description="Lead score between 0 and 100")
    RESPONSE: str = Field(..., description="Reasoning for the score. Write within the range of 50-100 words.")
    SHOULD_CONTACT: int = Field(..., description="1 if lead should be contacted, else 0")

class GeminiMessageResponse(BaseModel):
    SUBJECT: str = Field(..., description="A catchy subject line for the outreach email, within 5-7 words.")
    MESSAGE: str = Field(..., description="A personalized outreach message for the lead, within 50-70 words.")

# Load company context
with open("stages/wildnetEdge.txt", "r") as f:
    wildnet_edge_data = f.read()

# ----- Core function -----
def process_lead(lead_info: dict, api_key: str) -> dict:
    """
    1. Score lead (GeminiScoreResponse) using existing scoring prompt (unchanged).
    2. If score >= 50 generate SUBJECT + MESSAGE (GeminiMessageResponse).
       Else set both to 'ineligible'.
    3. Return required fields.
    """
    # -------- Scoring Phase (prompt kept exactly as in stage3.py) --------
    scoring_llm = ChatGoogleGenerativeAI(
        model='models/gemini-2.5-flash',
        google_api_key=api_key,
        temperature=0.3
    )
    score_parser = PydanticOutputParser(pydantic_object=GeminiScoreResponse)
    score_format = score_parser.get_format_instructions()

    scoring_system_msg = SystemMessage(content=f"""
You are an expert lead qualifier. We (WildnetEdge) as a company offer the following services to our clients:
WildnetEdge: ```{wildnet_edge_data}```

Your task is to evaluate each lead's potential whether they are a potential buyer of our (wildnetEdge's) salesforce service or whether they are potential seller of salesforce services like us (WildnetEdge). Refer following points to identify if they are a potential buyer and score on that basis:
Score the lead on a scale of 1-100 based on crieteria 1 and 2 and then multiply with a multiplier based on criteria 3 to get the final score:
Criteria - 1: The lead must be at the position of some authority like Manager, Sr. Manager, Director, Head, VP, C-suites, founder, etc. not at employee level (like Developer, Analyst, etc.). Give extra points and mention explicitly if they are in IT Department but only if they are among mentioned positions. (High weightage)
Criteria - 2: The COMPANY at which the lead is working MUST not offer IT or software services like WildnetEdge. In other words the industry of their company must not fall under "IT or software service" or any services that are mentioned above within triple backticks i.e. their company should not be our direct competitior or ours. Aditionally and VERY IMPORTANTLY, their company should not be a partner or reseller of Salesforce like us. Note: Your your intelligence and provided context about lead to evaluate what their company does, in case if you can't find out what their company does, just mention it in your response and give the score between 40-60 given 1st point is satisfied i.e. lead is at one of the mentioned position in company. Don't make any assumption (Very High Weightage)
Criteria - 3: This criteria is based on lead's location. After scoring based on above two criteria, apply following multiplier to the score:
- If lead's location is in USA, Canada, UK, Germany, Italy, France, Netherlands, Switzerland, Sweden, Ireland, Australia, Singapore - multiply the score by 1
- If lead's location is in India, UAE, Saudi Arabia, Israel, Qatar, Egypt - multiply the score by 0.8
- If lead's location is in any other country - multiply the score by 0.5
For ex. if lead scores 70 based on first two criteria and is located in USA, final score will be 70*1=70, if lead is located in India, final score will be 70*0.8=56 and if lead is located in any other country, final score will be 70*0.5=35.
""")

    scoring_human_msg = HumanMessage(content=f"""
Evaluate this lead for potential:
{lead_info}

Should we approach this lead? Score the leads based on above rule (0-100) and explain your reasoning and lead's location based on how well they match our services. Keep the score criteria strict and give high score only to those who fulfill all the criteria to a good extent.

{score_format}
""")

    score_raw = scoring_llm.invoke([scoring_system_msg, scoring_human_msg])
    score_parsed = score_parser.parse(score_raw.content)

    final_score = score_parsed.SCORE
    should_contact = score_parsed.SHOULD_CONTACT
    reasoning = score_parsed.RESPONSE

    # -------- Message Phase (only if score >= 50) --------
    if final_score >= 50:
        msg_llm = ChatGoogleGenerativeAI(
            model='models/gemini-2.5-flash',
            google_api_key=api_key,
            temperature=0.6
        )
        msg_parser = PydanticOutputParser(pydantic_object=GeminiMessageResponse)
        msg_format = msg_parser.get_format_instructions()

        # Using same wildnet_edge_data context; (original message.py prompt body not provided, keep minimal)
        message_system = SystemMessage(content=f"""
You are an expert SDR crafting concise personalized outreach.
Company context (WildnetEdge services):
```{wildnet_edge_data}```
Produce a compelling subject (5-7 words) and a personalized message (50-70 words) tailored to the lead.
""")

        message_human = HumanMessage(content=f"""
Lead info:
{lead_info}

Generate outreach.
{msg_format}
""")

        msg_raw = msg_llm.invoke([message_system, message_human])
        msg_parsed = msg_parser.parse(msg_raw.content)
        subject = msg_parsed.SUBJECT
        message = msg_parsed.MESSAGE
    else:
        subject = "ineligible"
        message = "ineligible"

    return {
        "lead_id": lead_info.get("lead_id"),
        "name": lead_info.get("name"),
        "linkedin_url": lead_info.get("profile_url") or lead_info.get("linkedin_url"),
        "location": lead_info.get("location"),
        "score": final_score,
        "response": reasoning,
        "should_contact": should_contact,
        "message": message,
        "subject": subject
    }

# Optional batch helper
def process_leads(leads, api_key: str):
    return [process_lead(ld, api_key) for ld in leads]

# if __name__ == "__main__":
#     # Simple manual test placeholder
#     api_key = os.getenv("GEMINI_API_KEY", "YOUR_KEY")
#     sample = {
#         "lead_id": "123",
#         "name": "Jane Doe",
#         "profile_url": "https://www.linkedin.com/in/example",
#         "location": "United States",
#         "title": "Director of Operations",
#         "company": "Acme Manufacturing",
#         "bio": "Operations leader focused on process optimization and enterprise systems transformation."
#     }
#     if api_key == "YOUR_KEY":
#         print("Set GEMINI_API_KEY in environment to run live test.")
#     else:
#         out = process_lead(sample, api_key)
#         print(json.dumps(out, indent=2))
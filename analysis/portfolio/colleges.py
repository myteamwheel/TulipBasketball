"""School -> (conference, level) for a player's FINAL college season, handling realignment.
Power = SEC/Big Ten/Big 12/ACC/Pac-12 (through 2023; Big East while it was a BCS AQ league), plus Notre Dame."""

ALIAS = {"Mississippi": "Ole Miss", "Miami": "Miami (FL)", "N.C. State": "NC State", "Southern Mississippi": "Southern Miss",
         "Texas-San Antonio": "UTSA", "University of South Florida": "South Florida", "Alabama-Birmingham": "UAB",
         "Louisiana-Lafayette": "Louisiana", "Texas-El Paso": "UTEP", "Florida International": "FIU", "Connecticut": "UConn",
         "Delta State University": "Delta State", "Campbell University": "Campbell", "Bemidji State University": "Bemidji State",
         "Fort Valley State College": "Fort Valley State", "Sacred Heart University": "Sacred Heart", "Virginia Commonwealth Univ.": "VCU",
         "Lenoir Rhyne": "Lenoir-Rhyne", "Ohio St.": "Ohio State", "Central Florida": "UCF", "Pittsburgh": "Pitt", "Brigham Young": "BYU",
         "Southern California": "USC", "Louisiana State": "LSU", "Texas Christian": "TCU", "Southern Methodist": "SMU",
         "Florida St.": "Florida State", "Penn St.": "Penn State", "Hawaii": "Hawai'i", "Nevada-Las Vegas": "UNLV",
         "Middle Tennessee State": "Middle Tennessee", "Appalachian State": "App State", "Louisiana-Monroe": "ULM",
         "Massachusetts": "UMass", "Miami (Ohio)": "Miami (OH)", "Miami, O.": "Miami (OH)", "Northern Illinois University": "Northern Illinois", "LA-Lafayette": "Louisiana", "North Carolina State": "NC State", "Sam Houston State": "Sam Houston", "UMass Amherst": "UMass", "Shepherd (WV)": "Shepherd", "Barton College": "Barton", "Prairie View": "Prairie View A&M", "Augustana (SD)": "Augustana", "Indiana PA,  University of": "IUP", "Pittsburg State (KS)": "Pittsburg State", "Stephen F. Austin State": "Stephen F. Austin", "Canisius College": "Canisius", "Concordia College": "Concordia-Moorhead", "Lafayette College": "Lafayette", "Berry College": "Berry"}

SEC = "Alabama Arkansas Auburn Florida Georgia Kentucky LSU|Mississippi State|Missouri|Ole Miss|South Carolina|Tennessee|Texas A&M|Vanderbilt"
BIG10 = "Illinois Indiana Iowa Maryland Michigan|Michigan State|Minnesota|Nebraska|Northwestern|Ohio State|Penn State|Purdue|Rutgers|Wisconsin"
BIG12 = "Baylor Iowa State|Kansas|Kansas State|Oklahoma State|TCU|Texas Tech|West Virginia"
ACC = "Boston College|Clemson|Duke|Florida State|Georgia Tech|Louisville|Miami (FL)|NC State|North Carolina|Pitt|Syracuse|Virginia|Virginia Tech|Wake Forest"
PAC = "Arizona|Arizona State|California|Colorado|Oregon|Oregon State|Stanford|UCLA|USC|Utah|Washington|Washington State"
AAC = "East Carolina|Memphis|Navy|South Florida|Temple|Tulane|Tulsa"
MWC = "Air Force|Boise State|Colorado State|Fresno State|Hawai'i|Nevada|New Mexico|San Diego State|San Jose State|UNLV|Utah State|Wyoming"
SBC = "App State|Arkansas State|Coastal Carolina|Georgia Southern|Georgia State|Louisiana|ULM|South Alabama|Texas State|Troy"
MAC = "Akron|Ball State|Bowling Green|Buffalo|Central Michigan|Eastern Michigan|Kent State|Miami (OH)|Northern Illinois|Ohio|Toledo|Western Michigan"
CUSA = "FIU|Louisiana Tech|Middle Tennessee|UTEP|Western Kentucky"
def _split(s):
    out = []
    for chunk in s.split("|"):
        out += [chunk] if " " in chunk and chunk not in ("Iowa State",) else chunk.split(" ") if chunk.count(" ") and chunk.split(" ")[0] in ("Alabama",) else [chunk]
    return out
BASE = {}
for conf, s in [("SEC", SEC), ("Big Ten", BIG10), ("Big 12", BIG12), ("ACC", ACC), ("Pac-12", PAC), ("AAC", AAC), ("MWC", MWC),
                ("Sun Belt", SBC), ("MAC", MAC), ("C-USA", CUSA)]:
    for school in s.replace("Alabama Arkansas Auburn Florida Georgia Kentucky LSU", "Alabama|Arkansas|Auburn|Florida|Georgia|Kentucky|LSU") \
                   .replace("Illinois Indiana Iowa Maryland Michigan", "Illinois|Indiana|Iowa|Maryland|Michigan") \
                   .replace("Baylor Iowa State", "Baylor|Iowa State").split("|"):
        BASE[school] = conf

def fbs_conf(school, yr):
    """Conference of an FBS school in season `yr` (None if not FBS that year)."""
    s, y = school, yr
    if s in ("Texas", "Oklahoma"): return "SEC" if y >= 2024 else "Big 12"
    if s in ("Oregon", "USC", "UCLA", "Washington"): return "Big Ten" if y >= 2024 else ("Pac-12" if y >= 2011 else "Pac-10")
    if s in ("Stanford", "California"): return "ACC" if y >= 2024 else ("Pac-12" if y >= 2011 else "Pac-10")
    if s in ("Arizona", "Arizona State"): return "Big 12" if y >= 2024 else ("Pac-12" if y >= 2011 else "Pac-10")
    if s == "Utah": return "Big 12" if y >= 2024 else ("Pac-12" if y >= 2011 else "MWC")
    if s == "Colorado": return "Big 12" if y >= 2024 else ("Pac-12" if y >= 2011 else "Big 12")
    if s in ("Oregon State", "Washington State"): return "Pac-12 (2-team)" if y >= 2024 else ("Pac-12" if y >= 2011 else "Pac-10")
    if s == "SMU": return "ACC" if y >= 2024 else ("AAC" if y >= 2013 else "C-USA")
    if s == "Cincinnati": return "Big 12" if y >= 2023 else ("AAC" if y >= 2013 else "Big East")
    if s == "Houston": return "Big 12" if y >= 2023 else ("AAC" if y >= 2013 else "C-USA")
    if s == "UCF": return "Big 12" if y >= 2023 else ("AAC" if y >= 2013 else "C-USA")
    if s == "BYU": return "Big 12" if y >= 2023 else ("Independent" if y >= 2011 else "MWC")
    if s == "TCU": return "Big 12" if y >= 2012 else "MWC"
    if s == "West Virginia": return "Big 12" if y >= 2012 else "Big East"
    if s in ("Missouri", "Texas A&M"): return "SEC" if y >= 2012 else "Big 12"
    if s == "Nebraska": return "Big Ten" if y >= 2011 else "Big 12"
    if s in ("Maryland",): return "Big Ten" if y >= 2014 else "ACC"
    if s == "Rutgers": return "Big Ten" if y >= 2014 else ("AAC" if y == 2013 else "Big East")
    if s == "Louisville": return "ACC" if y >= 2014 else ("AAC" if y == 2013 else "Big East")
    if s in ("Pitt", "Syracuse"): return "ACC" if y >= 2013 else "Big East"
    if s == "Boise State": return "MWC" if y >= 2011 else "WAC"
    if s == "Fresno State": return "MWC" if y >= 2012 else "WAC"
    if s in ("Nevada",): return "MWC" if y >= 2012 else "WAC"
    if s in ("San Jose State", "Utah State"): return "MWC" if y >= 2013 else "WAC"
    if s == "Memphis": return "AAC" if y >= 2013 else "C-USA"
    if s in ("Tulane", "Tulsa", "East Carolina"): return "AAC" if y >= 2014 else "C-USA"
    if s in ("South Florida", "Temple"): return "AAC" if y >= 2013 else "Big East"
    if s == "Navy": return "AAC" if y >= 2015 else "Independent"
    if s == "Army": return "AAC" if y >= 2024 else "Independent"
    if s in ("Charlotte", "Florida Atlantic", "North Texas", "Rice", "UAB", "UTSA"): return "AAC" if y >= 2023 else "C-USA"
    if s in ("Southern Miss", "Marshall", "Old Dominion"): return "Sun Belt" if y >= 2022 else "C-USA"
    if s == "James Madison": return "Sun Belt" if y >= 2022 else None
    if s in ("Liberty", "New Mexico State"): return "C-USA" if y >= 2023 else "Independent"
    if s in ("Jacksonville State", "Sam Houston"): return "C-USA" if y >= 2023 else None
    if s == "Kennesaw State": return "C-USA" if y >= 2024 else None
    if s in ("Delaware", "Missouri State"): return "C-USA" if y >= 2025 else None
    if s == "UConn": return "Independent" if y >= 2020 else "AAC" if y >= 2013 else "Big East"
    if s == "UMass": return "MAC" if y >= 2025 else "Independent"
    if s == "Notre Dame": return "Independent"
    if s == "Texas State": return "Sun Belt" if y >= 2013 else None
    if s in ("Georgia State", "Georgia Southern", "App State", "Coastal Carolina"): return "Sun Belt"
    return BASE.get(s)

# non-FBS programs seen in these leagues (level, conference at the player's final season)
NON_FBS = {"North Dakota State": ("FCS", "MVFC"), "South Dakota State": ("FCS", "MVFC"), "Youngstown State": ("FCS", "MVFC"),
           "Eastern Washington": ("FCS", "Big Sky"), "Weber State": ("FCS", "Big Sky"), "Maine": ("FCS", "CAA"), "William & Mary": ("FCS", "CAA"),
           "Holy Cross": ("FCS", "Patriot"), "East Tennessee State": ("FCS", "SoCon"), "Dayton": ("FCS", "Pioneer"), "Florida A&M": ("FCS", "SWAC"),
           "Campbell": ("FCS", "Big South"), "Yale": ("FCS", "Ivy"), "Harvard": ("FCS", "Ivy"), "Princeton": ("FCS", "Ivy"),
           "Southeast Missouri State": ("FCS", "Big South-OVC"), "Sacred Heart": ("FCS", "NEC"), "Southern Utah": ("FCS", "Big Sky"),
           "Tarleton State": ("FCS", "UAC"), "Delaware": ("FCS", "CAA"),
           "Delta State": ("D-II", "Gulf South"), "West Alabama": ("D-II", "Gulf South"), "Western State": ("D-II", "RMAC"),
           "Bemidji State": ("D-II", "NSIC"), "Minnesota State Moorhead": ("D-II", "NSIC"), "Fort Valley State": ("D-II", "SIAC"),
           "Shepherd": ("D-II", "PSAC"), "Malone": ("D-II", "G-MAC"), "Southern Arkansas": ("D-II", "GAC"), "Lenoir-Rhyne": ("D-II", "SAC"),
           "Hillsdale": ("D-II", "GMAC"), "Albany": ('FCS', 'CAA'), "Austin Peay": ('FCS', 'OVC'), "Brown": ('FCS', 'Ivy'), "Bryant": ('FCS', 'NEC'), "Cal Poly": ('FCS', 'Big Sky'), "Drake": ('FCS', 'Pioneer'), "Eastern Illinois": ('FCS', 'OVC'), "Eastern Kentucky": ('FCS', 'OVC'), "Elon": ('FCS', 'CAA'), "Fordham": ('FCS', 'Patriot'), "Furman": ('FCS', 'SoCon'), "Grambling State": ('FCS', 'SWAC'), "Hampton": ('FCS', 'CAA'), "Idaho": ('FCS', 'Big Sky'), "Idaho State": ('FCS', 'Big Sky'), "Illinois State": ('FCS', 'MVFC'), "Indiana State": ('FCS', 'MVFC'), "James Madison": ('FCS', 'CAA'), "Lafayette": ('FCS', 'Patriot'), "McNeese State": ('FCS', 'Southland'), "Missouri State": ('FCS', 'MVFC'), "Monmouth": ('FCS', 'NEC'), "Montana State": ('FCS', 'Big Sky'), "New Hampshire": ('FCS', 'CAA'), "North Carolina A&T": ('FCS', 'MEAC'), "Northern Colorado": ('FCS', 'Big Sky'), "Northern Iowa": ('FCS', 'MVFC'), "Penn": ('FCS', 'Ivy'), "Prairie View A&M": ('FCS', 'SWAC'), "Sacramento State": ('FCS', 'Big Sky'), "Samford": ('FCS', 'SoCon'), "San Diego": ('FCS', 'Pioneer'), "South Dakota": ('FCS', 'MVFC'), "Southeastern Louisiana": ('FCS', 'Southland'), "Southern Illinois": ('FCS', 'MVFC'), "Stephen F. Austin": ('FCS', 'WAC'), "Stetson": ('FCS', 'Pioneer'), "Tennessee-Martin": ('FCS', 'OVC'), "UC Davis": ('FCS', 'Big Sky'), "Wagner": ('FCS', 'NEC'), "Western Carolina": ('FCS', 'SoCon'), "Western Illinois": ('FCS', 'MVFC'), "Ashland": ('D-II', 'G-MAC'), "Assumption": ('D-II', 'NE-10'), "Augustana": ('D-II', 'NSIC'), "Barton": ('D-II', 'Conference Carolinas'), "Central Missouri": ('D-II', 'MIAA'), "Chadron State": ('D-II', 'RMAC'), "Charleston": ('D-II', 'MEC'), "East Central": ('D-II', 'GAC'), "Ferris State": ('D-II', 'GLIAC'), "IUP": ('D-II', 'PSAC'), "Kentucky Wesleyan": ('D-II', 'G-MAC'), "Kutztown": ('D-II', 'PSAC'), "Limestone": ('D-II', 'SAC'), "Mercyhurst": ('D-II', 'PSAC'), "Minnesota Duluth": ('D-II', 'NSIC'), "Minnesota State": ('D-II', 'NSIC'), "Pittsburg State": ('D-II', 'MIAA'), "Tiffin": ('D-II', 'G-MAC'), "Valdosta State": ('D-II', 'GSC'), "Virginia State": ('D-II', 'CIAA'), "Western Oregon": ('D-II', 'GNAC'), "Berry": ('D-III', 'SAA'), "Concordia-Moorhead": ('D-III', 'MIAC'), "Wisconsin-Platteville": ('D-III', 'WIAC'), "Wisconsin-Whitewater": ('D-III', 'WIAC'), "Canisius": ('No football', 'No football'), "UC Irvine": ('No football', 'No football'), "Wisconsin-Milwaukee": ('No football', 'No football'), "No College": ('No college', 'No college'), "Randolph-Macon": ("D-III", "ODAC"), "VCU": ("No football", "No football")}
POWER = {"SEC", "Big Ten", "Big 12", "ACC", "Pac-12", "Pac-10", "Big East"}
FORMER_PAC12 = set(PAC.split("|"))

def classify(school, final_season):
    """-> dict(school, conf, level, tier, former_pac12)"""
    s = ALIAS.get(school, school) if isinstance(school, str) else None
    if not s: return dict(school=None, conf=None, level=None, tier=None, former_pac12=False)
    y = int(final_season) if final_season == final_season and final_season is not None and final_season > 1990 else 2025
    c = fbs_conf(s, y)
    if c:
        tier = "Power" if (c in POWER and not (c == "Big East" and y >= 2013)) or s == "Notre Dame" else ("FBS Independent" if c == "Independent" else "Group of Five")
        if c == "Pac-12 (2-team)": tier = "Group of Five"
        return dict(school=s, conf=c, level="FBS", tier=tier, former_pac12=s in FORMER_PAC12)
    if s in NON_FBS:
        lvl, c = NON_FBS[s]
        return dict(school=s, conf=c, level=lvl, tier=lvl, former_pac12=False)
    return dict(school=s, conf="UNMAPPED", level="UNMAPPED", tier="UNMAPPED", former_pac12=False)

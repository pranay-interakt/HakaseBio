"""Citation registry.

Every scientific method and every reference parameter in the system points at an
entry here. Adding a method without adding its primary citation is a contract
violation (see ``CLAUDE.md`` rule 3).

Keys are stable; they appear in docstrings, method definitions and the rendered
provenance shown to users.
"""

from __future__ import annotations

from typing import Final

from hos.core.provenance import Citation

__all__ = ["CITATIONS", "cite"]


def _c(key: str, text: str, year: int | None = None, doi: str | None = None,
       url: str | None = None) -> tuple[str, Citation]:
    return key, Citation(key=key, text=text, year=year, doi=doi, url=url)


CITATIONS: Final[dict[str, Citation]] = dict(
    [
        # ---- cheminformatics / descriptors ----------------------------------
        _c("rdkit", "RDKit: Open-source cheminformatics. https://www.rdkit.org",
           url="https://www.rdkit.org"),
        _c("wildman1999",
           "Wildman SA, Crippen GM. Prediction of physicochemical parameters by "
           "atomic contributions. J Chem Inf Comput Sci. 1999;39(5):868-873.",
           year=1999, doi="10.1021/ci990307l"),
        _c("ertl2000",
           "Ertl P, Rohde B, Selzer P. Fast calculation of molecular polar surface area "
           "as a sum of fragment-based contributions and its application to the "
           "prediction of drug transport properties. J Med Chem. 2000;43(20):3714-3717.",
           year=2000, doi="10.1021/jm000942e"),
        _c("lipinski2001",
           "Lipinski CA, Lombardo F, Dominy BW, Feeney PJ. Experimental and computational "
           "approaches to estimate solubility and permeability in drug discovery and "
           "development settings. Adv Drug Deliv Rev. 2001;46(1-3):3-26.",
           year=2001, doi="10.1016/S0169-409X(00)00129-0"),
        _c("veber2002",
           "Veber DF, Johnson SR, Cheng HY, Smith BR, Ward KW, Kopple KD. Molecular "
           "properties that influence the oral bioavailability of drug candidates. "
           "J Med Chem. 2002;45(12):2615-2623.",
           year=2002, doi="10.1021/jm020017n"),
        _c("bickerton2012",
           "Bickerton GR, Paolini GV, Besnard J, Muresan S, Hopkins AL. Quantifying the "
           "chemical beauty of drugs. Nat Chem. 2012;4(2):90-98.",
           year=2012, doi="10.1038/nchem.1243"),
        # ---- DMPK / IVIVE ----------------------------------------------------
        _c("obach1999",
           "Obach RS. Prediction of human clearance of twenty-nine drugs from hepatic "
           "microsomal intrinsic clearance data: an examination of in vitro half-life "
           "approach and nonspecific binding to microsomes. Drug Metab Dispos. "
           "1999;27(11):1350-1359.",
           year=1999, doi="10.1016/S0090-9556(24)14938-0"),
        _c("wilkinson1975",
           "Wilkinson GR, Shand DG. Commentary: a physiological approach to hepatic drug "
           "clearance. Clin Pharmacol Ther. 1975;18(4):377-390.",
           year=1975, doi="10.1002/cpt1975184377"),
        _c("houston1994",
           "Houston JB. Utility of in vitro drug metabolism data in predicting in vivo "
           "metabolic clearance. Biochem Pharmacol. 1994;47(9):1469-1479.",
           year=1994, doi="10.1016/0006-2952(94)90520-7"),
        _c("hallifax2006",
           "Hallifax D, Houston JB. Binding of drugs to hepatic microsomes: comment and "
           "assessment of current prediction methodology with recommendation for "
           "improvement. Drug Metab Dispos. 2006;34(4):724-726.",
           year=2006, doi="10.1124/dmd.105.007658"),
        _c("gertz2008",
           "Gertz M, Kilford PJ, Houston JB, Galetin A. Drug lipophilicity and microsomal "
           "protein concentration as determinants in the prediction of the fraction unbound "
           "in microsomal incubations. Drug Metab Dispos. 2008;36(3):535-542.",
           year=2008, doi="10.1124/dmd.107.018713"),
        _c("riley2005",
           "Riley RJ, McGinnity DF, Austin RP. A unified model for predicting human "
           "hepatic, metabolic clearance from in vitro intrinsic clearance data in "
           "hepatocytes and microsomes. Drug Metab Dispos. 2005;33(9):1304-1311.",
           year=2005, doi="10.1124/dmd.105.004259"),
        _c("davies1993",
           "Davies B, Morris T. Physiological parameters in laboratory animals and "
           "humans. Pharm Res. 1993;10(7):1093-1095.",
           year=1993, doi="10.1023/A:1018943613122"),
        _c("barter2007",
           "Barter ZE, Bayliss MK, Beaune PH, et al. Scaling factors for the extrapolation "
           "of in vivo metabolic drug clearance from in vitro data: reaching a consensus on "
           "values of human microsomal protein and hepatocellularity per gram of liver. "
           "Curr Drug Metab. 2007;8(1):33-45.",
           year=2007, doi="10.2174/138920007779315053"),
        _c("hakooz2006",
           "Hakooz N, Ito K, Rawden H, et al. Determination of a human hepatic microsomal "
           "scaling factor for predicting in vivo drug clearance. Pharm Res. "
           "2006;23(3):533-539.",
           year=2006, doi="10.1007/s11095-006-9531-2"),
        _c("smith2008",
           "Smith R, Jones RDO, Ballard PG, Griffiths HH. Determination of microsome and "
           "hepatocyte scaling factors for in vitro/in vivo extrapolation in the rat and dog. "
           "Xenobiotica. 2008;38(11):1386-1398.",
           year=2008, doi="10.1080/00498250802491662"),
        _c("barter2008",
           "Barter ZE, Chowdry JE, Harlow JR, et al. Covariation of human microsomal protein "
           "per gram of liver with age: absence of influence of operator and sample storage "
           "may justify interlaboratory data pooling. Drug Metab Dispos. 2008;36(12):2405-2409.",
           year=2008, doi="10.1124/dmd.108.021311"),
        _c("di_kerns2016",
           "Di L, Kerns EH. Drug-Like Properties: Concepts, Structure Design and Methods "
           "from ADME to Toxicity Optimization. 2nd ed. Academic Press; 2016.",
           year=2016, doi="10.1016/C2013-0-18378-X"),
        # ---- pharmacokinetics / toxicokinetics ---------------------------------
        _c("fda_ba_2022",
           "U.S. Food and Drug Administration, CDER. Bioavailability Studies Submitted in NDAs "
           "or INDs - General Considerations. Guidance for Industry. April 2022.",
           year=2022, url="https://www.fda.gov/media/121311/download"),
        _c("ich_m13a",
           "ICH Harmonised Guideline M13A: Bioequivalence for Immediate-Release Solid Oral "
           "Dosage Forms. Final version, adopted 23 July 2024.",
           year=2024,
           url="https://database.ich.org/sites/default/files/ICH_M13A_Step4_Final_Guideline_"
               "2024_0723.pdf"),
        _c("cdisc_pk_terms",
           "CDISC SDTM Pharmacokinetic Parameters controlled terminology (PKPARM/PKPARMCD), "
           "published in the NCI Thesaurus, version 26.09d (2026-09-28).",
           year=2026,
           url="https://evsexplore.semantics.cancer.gov/evsexplore/concept/ncit/C85565"),
        _c("certara_phoenix_nca",
           "Certara USA, Inc. Phoenix 8.3 User Documentation: NCA parameter formulas; Partial "
           "area calculation; NCA computation rules; Lambda Z or Slope Estimation settings. "
           "2020. (Vendor documentation; a secondary source for the NCA equations.)",
           year=2020,
           url="https://onlinehelp.certara.com/phoenix/8.3/topics/Partial_area_calculation.htm"),
        _c("ema_be_2010",
           "European Medicines Agency, CHMP. Guideline on the Investigation of Bioequivalence. "
           "CPMP/EWP/QWP/1401/98 Rev. 1/Corr**. 20 January 2010.",
           year=2010,
           url="https://www.ema.europa.eu/en/documents/scientific-guideline/guideline-"
               "investigation-bioequivalence-rev1_en.pdf"),
        _c("benet2012",
           "Benet LZ. Benet LZ and Galeazzi RL: noncompartmental determination of the "
           "steady-state volume of distribution, J Pharm Sci 68, 1071-1074, 1979 - the "
           "backstory. AAPS J. 2012;14(2):164-167.",
           year=2012, doi="10.1208/s12248-012-9326-9"),
        _c("waters2008",
           "Waters NJ, Jones R, Williams G, Sohal B. Validation of a rapid equilibrium dialysis "
           "approach for the measurement of plasma protein binding. J Pharm Sci. "
           "2008;97(10):4586-4595.",
           year=2008, doi="10.1002/jps.21317"),
        _c("thermo_red_2023",
           "Thermo Fisher Scientific. Pierce RED Device Inserts User Guide (Cat. 89809, 89810). "
           "Pub. No. MAN0011571, Rev. C.0, 16 June 2023. (Manufacturer instructions; a "
           "secondary source for the fraction-unbound calculation.)",
           year=2023,
           url="https://assets.thermofisher.com/TFS-Assets/LSG/manuals/"
               "MAN0011571_RED_Device_Insert_UG.pdf"),
        _c("ich_m12",
           "ICH Harmonised Guideline M12: Drug Interaction Studies. Final version, adopted 21 May "
           "2024.",
           year=2024,
           url="https://database.ich.org/sites/default/files/ICH_M12_Step4_Guideline_2024_0521.pdf"),
        _c("di2012",
           "Di L, Umland JP, Trapa PE, Maurer TS. Impact of recovery on fraction unbound using "
           "equilibrium dialysis. J Pharm Sci. 2012;101(3):1327-1335.",
           year=2012, doi="10.1002/jps.23013"),
        _c("di2017",
           "Di L, Breen C, Chambers R, et al. Industry perspective on contemporary "
           "protein-binding methodologies: considerations for regulatory drug-drug interaction "
           "and related guidelines on highly bound drugs. J Pharm Sci. 2017;106(12):3442-3452.",
           year=2017, doi="10.1016/j.xphs.2017.09.005"),
        _c("ryu2019",
           "Ryu S, Riccardi K, Patel R, Zueva L, Burchett W, Di L. Applying two orthogonal "
           "methods to assess accuracy of plasma protein binding measurements for highly bound "
           "compounds. J Pharm Sci. 2019;108(11):3745-3749.",
           year=2019, doi="10.1016/j.xphs.2019.08.004"),
        _c("purves1992",
           "Purves RD. Optimum numerical integration methods for estimation of "
           "area-under-the-curve (AUC) and area-under-the-moment-curve (AUMC). "
           "J Pharmacokinet Biopharm. 1992;20(3):211-226.",
           year=1992, doi="10.1007/BF01062525"),
        _c("smith2000",
           "Smith BP, Vandenhende FR, DeSante KA, Farid NA, Welch PA, Callaghan JT, Forgue ST. "
           "Confidence interval criteria for assessment of dose proportionality. Pharm Res. "
           "2000;17(10):1278-1283.",
           year=2000, doi="10.1023/A:1026451721686"),
        _c("hummel2009",
           "Hummel J, McKendrick S, Brindley C, French R. Exploratory assessment of dose "
           "proportionality: review of current approaches and proposal for a practical "
           "criterion. Pharm Stat. 2009;8(1):38-49.",
           year=2009, doi="10.1002/pst.326"),
        _c("braeckman2022",
           "Braeckman R, Guenther S, Mickle TC, Barrett AC, Smith A, Oh C. Dose proportionality "
           "and steady-state pharmacokinetics of serdexmethylphenidate/dexmethylphenidate, a "
           "novel prodrug combination to treat attention-deficit/hyperactivity disorder. "
           "J Child Adolesc Psychopharmacol. 2022;32(5):288-295.",
           year=2022, doi="10.1089/cap.2022.0015"),
        _c("shang2022",
           "Shang H, Dai X, Li M, Kai Y, Liu Z, Wang M, Li Q, Gu Y, Liu C, Si D. Absolute "
           "bioavailability, dose proportionality, and tissue distribution of rotundic acid in "
           "rats based on validated LC-QqQ-MS/MS method. J Pharm Anal. 2022;12(2):278-286.",
           year=2022, doi="10.1016/j.jpha.2021.03.008"),
        # ---- pharmacology / curve fitting ------------------------------------
        _c("delean1978",
           "DeLean A, Munson PJ, Rodbard D. Simultaneous analysis of families of sigmoidal "
           "curves: application to bioassay, radioligand assay, and physiological "
           "dose-response curves. Am J Physiol. 1978;235(2):E97-E102.",
           year=1978, doi="10.1152/ajpendo.1978.235.2.E97"),
        _c("ritz2015",
           "Ritz C, Baty F, Streibig JC, Gerhard D. Dose-response analysis using R. PLoS One. "
           "2015;10(12):e0146021.",
           year=2015, doi="10.1371/journal.pone.0146021"),
        _c("redfern2003",
           "Redfern WS, Carlsson L, Davis AS, et al. Relationships between preclinical "
           "cardiac electrophysiology, clinical QT interval prolongation and torsade de "
           "pointes for a broad range of drugs. Cardiovasc Res. 2003;58(1):32-45.",
           year=2003, doi="10.1016/S0008-6363(02)00846-5"),
        _c("crumb2016",
           "Crumb WJ Jr, Vicente J, Johannesen L, Strauss DG. An evaluation of 30 clinical drugs "
           "against the comprehensive in vitro proarrhythmia assay (CiPA) proposed ion channel "
           "panel. J Pharmacol Toxicol Methods. 2016;81:251-262.",
           year=2016, doi="10.1016/j.vascn.2016.03.009"),
        _c("ridder2020",
           "Ridder BJ, Leishman DJ, Bridgland-Taylor M, et al. A systematic strategy for "
           "estimating hERG block potency and its implications in a new cardiac safety "
           "paradigm. Toxicol Appl Pharmacol. 2020;394:114961.",
           year=2020, doi="10.1016/j.taap.2020.114961"),
        _c("jaki2013",
           "Jaki T, Hothorn LA. Statistical evaluation of toxicological assays: Dunnett or "
           "Williams test - take both. Arch Toxicol. 2013;87(11):1901-1910.",
           year=2013, doi="10.1007/s00204-013-1065-x"),
        _c("dunnett1955",
           "Dunnett CW. A multiple comparison procedure for comparing several treatments "
           "with a control. J Am Stat Assoc. 1955;50(272):1096-1121.",
           year=1955, doi="10.1080/01621459.1955.10501294"),
        _c("oecd_tg407",
           "OECD. Test No. 407: Repeated Dose 28-day Oral Toxicity Study in Rodents. OECD "
           "Guidelines for the Testing of Chemicals, Section 4. Adopted 2008.",
           year=2008, doi="10.1787/9789264070684-en"),
        _c("oecd_tg408",
           "OECD. Test No. 408: Repeated Dose 90-Day Oral Toxicity Study in Rodents. OECD "
           "Guidelines for the Testing of Chemicals, Section 4. Revised 2018.",
           year=2018, doi="10.1787/9789264070707-en"),
        _c("oecd_tg409",
           "OECD. Test No. 409: Repeated Dose 90-Day Oral Toxicity Study in Non-Rodents. OECD "
           "Guidelines for the Testing of Chemicals, Section 4. Adopted 1998.",
           year=1998, doi="10.1787/9789264070721-en"),
        # ---- regulatory ------------------------------------------------------
        _c("oecd_tg471",
           "OECD. Test No. 471: Bacterial Reverse Mutation Test. OECD Guidelines for the "
           "Testing of Chemicals, Section 4. Adopted 21 July 1997; corrected 26 June 2020.",
           year=2020, doi="10.1787/9789264071247-en"),
        _c("fda_mrsd_2005",
           "U.S. Food and Drug Administration. Guidance for Industry: Estimating the "
           "Maximum Safe Starting Dose in Initial Clinical Trials for Therapeutics in "
           "Adult Healthy Volunteers. CDER, July 2005.",
           year=2005, url="https://www.fda.gov/media/72309/download"),
        _c("ich_m3r2",
           "ICH Harmonised Tripartite Guideline M3(R2): Guidance on Nonclinical Safety "
           "Studies for the Conduct of Human Clinical Trials and Marketing Authorization "
           "for Pharmaceuticals. Step 4, 11 June 2009.",
           year=2009, url="https://database.ich.org/sites/default/files/M3_R2__Guideline.pdf"),
        _c("ich_s2r1",
           "ICH Harmonised Tripartite Guideline S2(R1): Guidance on Genotoxicity Testing "
           "and Data Interpretation for Pharmaceuticals Intended for Human Use. Step 4, 9 November 2011.",
           year=2011, url="https://database.ich.org/sites/default/files/S2_R1_Guideline.pdf"),
        _c("ich_s7a",
           "ICH Harmonised Tripartite Guideline S7A: Safety Pharmacology Studies for "
           "Human Pharmaceuticals. Step 4, 8 November 2000.",
           year=2000, url="https://database.ich.org/sites/default/files/S7A_Guideline.pdf"),
        _c("ich_s7b",
           "ICH Harmonised Tripartite Guideline S7B: The Nonclinical Evaluation of the "
           "Potential for Delayed Ventricular Repolarization (QT Interval Prolongation) "
           "by Human Pharmaceuticals. Step 4, 12 May 2005.",
           year=2005, url="https://database.ich.org/sites/default/files/S7B_Guideline.pdf"),
        _c("ich_e14_s7b_qa",
           "ICH E14/S7B Implementation Working Group. Clinical and Nonclinical Evaluation of "
           "QT/QTc Interval Prolongation and Proarrhythmic Potential: Questions and Answers. "
           "Adopted 21 February 2022.",
           year=2022, url="https://database.ich.org/sites/default/files/E14-S7B_QAs_Step4_2022_0221.pdf"),
        _c("ich_s9",
           "ICH Harmonised Tripartite Guideline S9: Nonclinical Evaluation for Anticancer "
           "Pharmaceuticals. Step 4, 29 October 2009.",
           year=2009, url="https://database.ich.org/sites/default/files/S9_Guideline.pdf"),
        _c("ich_s6r1",
           "ICH Harmonised Tripartite Guideline S6(R1): Preclinical Safety Evaluation of "
           "Biotechnology-Derived Pharmaceuticals. Step 4 16 July 1997; Addendum Step 4, 12 June 2011.",
           year=2011, url="https://database.ich.org/sites/default/files/S6_R1_Guideline_0.pdf"),
        _c("ich_s5r3",
           "ICH Harmonised Guideline S5(R3): Detection of Reproductive and Developmental "
           "Toxicity for Human Pharmaceuticals. Step 4, 18 February 2020.",
           year=2020, url="https://database.ich.org/sites/default/files/S5-R3_Step4_Guideline_2020_0218_1.pdf"),
        _c("ich_s1a",
           "ICH Harmonised Tripartite Guideline S1A: Guideline on the Need for "
           "Carcinogenicity Studies of Pharmaceuticals. Step 4, 29 November 1995.",
           year=1995, url="https://database.ich.org/sites/default/files/S1A_Guideline.pdf"),
        _c("ich_s1b_r1",
           "ICH Harmonised Guideline S1B(R1): Testing for Carcinogenicity of "
           "Pharmaceuticals. Adopted 4 August 2022.",
           year=2022,
           url="https://database.ich.org/sites/default/files/S1B-R1_FinalGuideline_2022_0719.pdf"),
        _c("ich_s8",
           "ICH Harmonised Tripartite Guideline S8: Immunotoxicity Studies for Human "
           "Pharmaceuticals. Step 4, 15 September 2005.",
           year=2005, url="https://database.ich.org/sites/default/files/S8_Guideline.pdf"),
        _c("ich_s10",
           "ICH Harmonised Guideline S10: Photosafety Evaluation of Pharmaceuticals. "
           "Step 4, 13 November 2013.",
           year=2013, url="https://database.ich.org/sites/default/files/S10_Guideline.pdf"),
        _c("ich_s11",
           "ICH Harmonised Guideline S11: Nonclinical Safety Testing in Support of "
           "Development of Paediatric Pharmaceuticals. Step 4, 14 April 2020.",
           year=2020, url="https://database.ich.org/sites/default/files/S11_Step4_FinalGuideline_2020_0310.pdf"),
        _c("ich_m4s_r2",
           "ICH Harmonised Tripartite Guideline M4S(R2): The Common Technical Document for the "
           "Registration of Pharmaceuticals for Human Use: Safety. Step 4, 20 December 2002.",
           year=2002, url="https://database.ich.org/sites/default/files/M4S_R2_Guideline.pdf"),
        _c("ich_m10",
           "ICH Harmonised Guideline M10: Bioanalytical Method Validation and Study "
           "Sample Analysis. Step 4, 24 May 2022.",
           year=2022, url="https://database.ich.org/sites/default/files/M10_Guideline_Step4_2022_0524.pdf"),
        _c("ich_s3a",
           "ICH Harmonised Tripartite Guideline S3A: Note for Guidance on Toxicokinetics: "
           "The Assessment of Systemic Exposure in Toxicity Studies. Step 4, 27 October 1994.",
           year=1994, url="https://database.ich.org/sites/default/files/S3A_Guideline.pdf"),
        _c("ema_fih_2017",
           "EMA. Guideline on strategies to identify and mitigate risks for first-in-human "
           "and early clinical trials with investigational medicinal products. "
           "EMEA/CHMP/SWP/28367/07 Rev. 1, July 2017.",
           year=2017,
           url="https://www.ema.europa.eu/en/documents/scientific-guideline/guideline-strategies-"
               "identify-and-mitigate-risks-first-human-and-early-clinical-trials-investigational-"
               "medicinal-products-revision-1_en.pdf"),
        _c("fda_cber_cgt_2013",
           "U.S. Food and Drug Administration, CBER. Guidance for Industry: Preclinical "
           "Assessment of Investigational Cellular and Gene Therapy Products. November 2013.",
           year=2013,
           url="https://www.fda.gov/regulatory-information/search-fda-guidance-documents/"
               "preclinical-assessment-investigational-cellular-and-gene-therapy-products"),
        _c("cfr21_58",
           "U.S. Code of Federal Regulations, Title 21, Part 58: Good Laboratory Practice "
           "for Nonclinical Laboratory Studies.",
           url="https://www.ecfr.gov/current/title-21/chapter-I/subchapter-A/part-58"),
        _c("cfr21_11",
           "U.S. Code of Federal Regulations, Title 21, Part 11: Electronic Records; "
           "Electronic Signatures.",
           url="https://www.ecfr.gov/current/title-21/chapter-I/subchapter-A/part-11"),
        _c("cfr21_312_23",
           "U.S. Code of Federal Regulations, Title 21, Section 312.23: IND content and "
           "format.",
           url="https://www.ecfr.gov/current/title-21/chapter-I/subchapter-D/part-312/subpart-B/section-312.23"),
    ]
)


def cite(key: str) -> Citation:
    """Look up a citation by key, raising a clear error if it is missing."""
    try:
        return CITATIONS[key]
    except KeyError:
        raise KeyError(
            f"unknown citation key {key!r}. Add it to hos/core/citations.py with the "
            "full primary reference before using it."
        ) from None

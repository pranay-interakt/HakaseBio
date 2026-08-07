#!/usr/bin/env Rscript
# =============================================================================
# L3 Animal Cohort — mrgsolve whole-body PBPK population runner.
#
# A perfusion-limited whole-body PBPK model expressed in mrgsolve's C++ ODE DSL,
# parameterised by the SAME disposition (CL, Kp, fu, BPR, extraction ratio) and
# species physiology (organ volumes & flows) that drive the in-house kernel
# engine — so the two are directly comparable (cross-validation). All time in
# HOURS; flows in L/h; volumes in L; amounts in mg; concentrations in mg/L.
#
# Equations match kernel/pbpk/model.py exactly (perfusion-limited transport;
# hepatic elimination via the recovered flow-independent intrinsic clearance;
# renal elimination as plasma-referenced filtration).
#
# IO contract: argv[1] = path to input JSON; JSON result printed to stdout.
# Returns the same cohort shape the kernel produces: {time, curves{organ:{mean,
# p05,p95}}, endpoints{organ:{c_max,t_max,auc,cl,vss,t_half}}}.
# =============================================================================

suppressWarnings(suppressMessages({
  # Prepend the user library (R_LIBS_USER if set — e.g. Docker's /root/Rlibs —
  # else ~/Rlibs) while keeping R's defaults.
  .libPaths(c(Sys.getenv("R_LIBS_USER", unset = path.expand("~/Rlibs")), .libPaths()))
  library(mrgsolve)
  library(jsonlite)
}))

`%||%` <- function(a, b) if (is.null(a) || (length(a) == 1 && is.na(a))) b else a

args <- commandArgs(trailingOnly = TRUE)
if (length(args) < 1) stop("usage: run_mrgsolve.R <input.json>")
inp <- fromJSON(args[1], simplifyVector = TRUE)

# ---- Compartment order (indices used in the dosing data set) ----------------
# DEPOT=1 ART=2 VEN=3 LUNG=4 LIVER=5 KIDNEY=6 HEART=7 BRAIN=8 MUSCLE=9
# ADIPOSE=10 SKIN=11 GUT=12 SPLEEN=13 REST=14

model_code <- '
$PARAM
V_art=1, V_ven=1, V_lung=1, V_liver=1, V_kidney=1, V_heart=1, V_brain=1,
V_muscle=1, V_adipose=1, V_skin=1, V_gut=1, V_spleen=1, V_rest=1,
Q_total=1, Q_liver=1, Q_ha=1, Q_gut=1, Q_spleen=1, Q_kidney=1, Q_heart=1,
Q_brain=1, Q_muscle=1, Q_adipose=1, Q_skin=1, Q_rest=1,
Kp_lung=1, Kp_liver=1, Kp_kidney=1, Kp_heart=1, Kp_brain=1, Kp_muscle=1,
Kp_adipose=1, Kp_skin=1, Kp_gut=1, Kp_spleen=1, Kp_rest=1,
CLhep_abs=0, CLren_abs=0, BPR=1, ka=1, route=0

$CMT DEPOT ART VEN LUNG LIVER KIDNEY HEART BRAIN MUSCLE ADIPOSE SKIN GUT SPLEEN REST

$ODE
double Cart = ART/V_art;
double Cven = VEN/V_ven;
double Cout_lung    = (LUNG/V_lung/Kp_lung)*BPR;
double Cout_liver   = (LIVER/V_liver/Kp_liver)*BPR;
double Cout_kidney  = (KIDNEY/V_kidney/Kp_kidney)*BPR;
double Cout_heart   = (HEART/V_heart/Kp_heart)*BPR;
double Cout_brain   = (BRAIN/V_brain/Kp_brain)*BPR;
double Cout_muscle  = (MUSCLE/V_muscle/Kp_muscle)*BPR;
double Cout_adipose = (ADIPOSE/V_adipose/Kp_adipose)*BPR;
double Cout_skin    = (SKIN/V_skin/Kp_skin)*BPR;
double Cout_gut     = (GUT/V_gut/Kp_gut)*BPR;
double Cout_spleen  = (SPLEEN/V_spleen/Kp_spleen)*BPR;
double Cout_rest    = (REST/V_rest/Kp_rest)*BPR;

double gi_in = (route==1) ? ka*DEPOT : 0.0;
double sc_in = (route==2) ? ka*DEPOT : 0.0;
dxdt_DEPOT = (route==1 || route==2) ? -ka*DEPOT : 0.0;

double elim_liver  = CLhep_abs * Cout_liver;
double elim_kidney = CLren_abs * Cout_kidney;

dxdt_LUNG = Q_total*(Cven - Cout_lung);
dxdt_ART  = Q_total*(Cout_lung - Cart);

dxdt_KIDNEY  = Q_kidney *(Cart - Cout_kidney) - elim_kidney;
dxdt_HEART   = Q_heart  *(Cart - Cout_heart);
dxdt_BRAIN   = Q_brain  *(Cart - Cout_brain);
dxdt_MUSCLE  = Q_muscle *(Cart - Cout_muscle);
dxdt_ADIPOSE = Q_adipose*(Cart - Cout_adipose);
dxdt_SKIN    = Q_skin   *(Cart - Cout_skin);
dxdt_REST    = Q_rest   *(Cart - Cout_rest);
dxdt_GUT     = Q_gut    *(Cart - Cout_gut) + gi_in;
dxdt_SPLEEN  = Q_spleen *(Cart - Cout_spleen);

double Cin_liver = (Q_ha*Cart + Q_gut*Cout_gut + Q_spleen*Cout_spleen)/Q_liver;
dxdt_LIVER = Q_liver*(Cin_liver - Cout_liver) - elim_liver;

double venous_return = Q_kidney*Cout_kidney + Q_heart*Cout_heart + Q_brain*Cout_brain
  + Q_muscle*Cout_muscle + Q_adipose*Cout_adipose + Q_skin*Cout_skin + Q_rest*Cout_rest
  + Q_liver*Cout_liver;
dxdt_VEN = venous_return + sc_in - Q_total*Cven;

$TABLE
capture plasma  = VEN/V_ven;
capture liver   = LIVER/V_liver;
capture kidney  = KIDNEY/V_kidney;
capture heart   = HEART/V_heart;
capture brain   = BRAIN/V_brain;
capture muscle  = MUSCLE/V_muscle;
capture adipose = ADIPOSE/V_adipose;
'

# Persistent compiled-model cache so repeated calls skip recompilation.
soloc <- path.expand("~/.hakase_mrgsolve_cache")
dir.create(soloc, showWarnings = FALSE, recursive = TRUE)
mod <- mcode("l3pbpk", model_code, soloc = soloc, quiet = TRUE)

# ---- Inputs -----------------------------------------------------------------
time_h  <- as.numeric(inp$time_h)
n       <- as.integer(inp$n_animals)
seed    <- as.integer(inp$seed)
bw_cv   <- as.numeric(inp$bw_cv %||% 0.15)
bw_base <- as.numeric(inp$bw_kg)
route_s <- toupper(inp$route)
route   <- if (route_s == "ORAL") 1 else if (route_s == "SC") 2 else 0
dose_mgkg <- as.numeric(inp$dose_mg_per_kg)
ka      <- as.numeric(inp$ka_per_h %||% 1.0)
f_abs   <- as.numeric(inp$f_abs %||% 1.0)
tinf    <- inp$infusion_duration_h
tau     <- inp$tau_h
n_doses <- as.integer(inp$n_doses %||% 1)
bpr     <- as.numeric(inp$bpr)
eh      <- min(max(as.numeric(inp$extraction_ratio %||% 0.0), 0.0), 0.99)
cl_hep  <- as.numeric(inp$cl_hepatic_ml_min_kg)   # per kg
cl_ren  <- as.numeric(inp$cl_renal_ml_min_kg %||% 0.0)
cl_gsd  <- as.numeric(inp$cl_gsd %||% 1.0)
V       <- inp$V     # named list, L at base bw
Q       <- inp$Q     # named list, L/h at base bw
Kp      <- inp$Kp    # named list

set.seed(seed)
# Body weight ~ lognormal(CV); flows scale bw^0.75, volumes bw^1.0 (kernel rule).
sigma_bw <- sqrt(log(1 + bw_cv^2))
mu_bw    <- log(bw_base) - 0.5 * sigma_bw^2
bw_i     <- rlnorm(n, meanlog = mu_bw, sdlog = sigma_bw)
sf_flow  <- (bw_i / bw_base)^0.75
sf_vol   <- (bw_i / bw_base)
# Optional extra clearance variability (lognormal GSD); 1.0 = none.
cl_factor <- if (cl_gsd > 1.0) rlnorm(n, meanlog = -0.5*log(cl_gsd)^2, sdlog = log(cl_gsd)) else rep(1.0, n)

# Recovered flow-independent intrinsic clearance (per animal, L/h):
#   cl_int_u = cl_hep / (BPR*(1-Eh)) * bw/1000 * 60
CLhep_abs <- (cl_hep * cl_factor) / (bpr * (1 - eh)) * bw_i / 1000 * 60
CLren_abs <- (cl_ren / bpr) * bw_i / 1000 * 60   # plasma-referenced filtration

# Per-animal dose (mg) and steady-state Vd (L/kg) for t-half.
dose_i <- dose_mgkg * bw_i
Vblood <- V$art + V$ven
vss_perkg <- sapply(seq_len(n), function(i) {
  s <- (V$art + V$ven) * sf_vol[i] * bpr
  for (org in c("lung","liver","kidney","heart","brain","muscle","adipose","skin","gut","spleen","rest")) {
    s <- s + V[[org]] * sf_vol[i] * (Kp[[org]] %||% 1.0)
  }
  s / bw_i[i]
})

# ---- Build the population data set (one dosing row per animal) ---------------
row <- function(i) {
  amt  <- if (route == 0) dose_i[i] else dose_i[i] * f_abs
  cmt  <- if (route == 0) 3L else 1L      # IV -> VEN(3); oral/sc -> DEPOT(1)
  rate <- if (route == 0 && !is.null(tinf) && !is.na(tinf) && tinf > 0) dose_i[i]/as.numeric(tinf) else 0
  ii   <- if (!is.null(tau) && !is.na(tau) && n_doses > 1) as.numeric(tau) else 0
  addl <- if (!is.null(tau) && !is.na(tau) && n_doses > 1) (n_doses - 1L) else 0L
  data.frame(
    ID = i, time = 0, evid = 1, amt = amt, cmt = cmt, rate = rate, ii = ii, addl = addl,
    V_art = V$art*sf_vol[i], V_ven = V$ven*sf_vol[i], V_lung = V$lung*sf_vol[i],
    V_liver = V$liver*sf_vol[i], V_kidney = V$kidney*sf_vol[i], V_heart = V$heart*sf_vol[i],
    V_brain = V$brain*sf_vol[i], V_muscle = V$muscle*sf_vol[i], V_adipose = V$adipose*sf_vol[i],
    V_skin = V$skin*sf_vol[i], V_gut = V$gut*sf_vol[i], V_spleen = V$spleen*sf_vol[i],
    V_rest = V$rest*sf_vol[i],
    Q_total = Q$total*sf_flow[i], Q_liver = Q$liver*sf_flow[i], Q_ha = Q$hepatic_artery*sf_flow[i],
    Q_gut = Q$gut*sf_flow[i], Q_spleen = Q$spleen*sf_flow[i], Q_kidney = Q$kidney*sf_flow[i],
    Q_heart = Q$heart*sf_flow[i], Q_brain = Q$brain*sf_flow[i], Q_muscle = Q$muscle*sf_flow[i],
    Q_adipose = Q$adipose*sf_flow[i], Q_skin = Q$skin*sf_flow[i], Q_rest = Q$rest*sf_flow[i],
    Kp_lung = Kp$lung%||%1, Kp_liver = Kp$liver%||%1, Kp_kidney = Kp$kidney%||%1,
    Kp_heart = Kp$heart%||%1, Kp_brain = Kp$brain%||%1, Kp_muscle = Kp$muscle%||%1,
    Kp_adipose = Kp$adipose%||%1, Kp_skin = Kp$skin%||%1, Kp_gut = Kp$gut%||%1,
    Kp_spleen = Kp$spleen%||%1, Kp_rest = Kp$rest%||%1,
    CLhep_abs = CLhep_abs[i], CLren_abs = CLren_abs[i], BPR = bpr,
    ka = if (route == 0) 0 else ka, route = route
  )
}
dat <- do.call(rbind, lapply(seq_len(n), row))

# ---- Simulate the population over the requested time grid --------------------
tend  <- max(time_h)
delta <- if (length(time_h) > 1) tend / (length(time_h) - 1) else 1
out <- mod %>% data_set(dat) %>%
  mrgsim(end = tend, delta = delta, atol = 1e-9, rtol = 1e-6, obsonly = TRUE, recsort = 3)
df  <- as.data.frame(out)
# Keep observation rows only and one row per (ID,time) so per-animal series align.
df  <- df[!duplicated(df[c("ID","time")]), ]

organs <- c("plasma","liver","kidney","heart","brain","muscle","adipose")
tgrid  <- sort(unique(df$time))

qsummary <- function(x) list(median = median(x), p05 = as.numeric(quantile(x,0.05)),
                             p95 = as.numeric(quantile(x,0.95)))
trapz <- function(t, y) sum(diff(t) * (head(y,-1)+tail(y,-1))/2)

curves <- list(); endpoints <- list()
for (org in organs) {
  wide <- do.call(cbind, split(df[[org]], df$ID))
  tvec <- sort(unique(df$time))
  curves[[org]] <- list(
    mean = as.numeric(rowMeans(wide)),
    p05  = as.numeric(apply(wide, 1, quantile, 0.05)),
    p95  = as.numeric(apply(wide, 1, quantile, 0.95))
  )
  cmax <- apply(wide, 2, max)
  tmax <- apply(wide, 2, function(c) tvec[which.max(c)])
  auc  <- apply(wide, 2, function(c) trapz(tvec, c))
  ep <- list(c_max = qsummary(cmax), t_max = qsummary(tmax), auc = qsummary(auc))
  if (org == "plasma") {
    cl <- dose_i / auc                          # L/h
    vss_l <- vss_perkg * bw_i
    thalf <- log(2) * vss_l / cl
    ep$cl     <- qsummary(cl)
    ep$vss    <- qsummary(vss_perkg)
    ep$t_half <- qsummary(thalf)
  }
  endpoints[[org]] <- ep
}

result <- list(
  engine = "mrgsolve",
  mrgsolve_version = as.character(packageVersion("mrgsolve")),
  n_animals = n,
  time = tgrid,
  curves = curves,
  endpoints = endpoints
)
cat(toJSON(result, auto_unbox = TRUE, digits = 8, na = "null"))

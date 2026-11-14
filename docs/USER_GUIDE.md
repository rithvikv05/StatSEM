# StatSEM Comprehensive User Guide

Welcome to **StatSEM**, a high-performance, modern application for variance-based Structural Equation Modeling (PLS-SEM). StatSEM combines an intuitive vector-based graphical modeling canvas with an ultrafast mathematical computation engine, real-time diagnostics, and publication-ready reporting.

---

## Table of Contents

1. [System Architecture & Core Concepts](#1-system-architecture--core-concepts)
2. [Workspaces & Studies](#2-workspaces--studies)
3. [Tab Management System](#3-tab-management-system)
4. [Dataset Import & Data Screening](#4-dataset-import--data-screening)
5. [The Graphical Model Editor](#5-the-graphical-model-editor)
   - [Canvas Navigation & Controls](#canvas-navigation--controls)
   - [Creating Latent Constructs](#creating-latent-constructs)
   - [Assigning Manifest Indicators](#assigning-manifest-indicators)
   - [Drawing Structural Paths](#drawing-structural-paths)
   - [Moderating Effects (Interaction Terms)](#moderating-effects-interaction-terms)
   - [Nonlinear Quadratic Effects](#nonlinear-quadratic-effects)
   - [Gaussian Copula Endogeneity Assessment](#gaussian-copula-endogeneity-assessment)
   - [Intelligent Auto-Align & Layout Engine](#intelligent-auto-align--layout-engine)
   - [Customizing Styles, Borders, and Typography](#customizing-styles-borders-and-typography)
6. [Calculation Engine & Workflows](#6-calculation-engine--workflows)
   - [PLS-SEM Algorithm Runner](#pls-sem-algorithm-runner)
   - [Parallel Bootstrapping](#parallel-bootstrapping)
   - [Blindfolding (Predictive Relevance Q²)](#blindfolding-predictive-relevance-q)
   - [Multigroup Analysis (MGA) & Permutation Testing](#multigroup-analysis-mga--permutation-testing)
7. [Results Exploration & Model HUD](#7-results-exploration--model-hud)
8. [Snapshots & Model Versioning](#8-snapshots--model-versioning)
9. [Exporting Diagrams & Comprehensive Reports](#9-exporting-diagrams--comprehensive-reports)
10. [Keyboard Shortcuts & Productivity Tips](#10-keyboard-shortcuts--productivity-tips)

---

## 1. System Architecture & Core Concepts

StatSEM is organized hierarchically:
- **Workspace**: A project container linked directly to a directory on your local filesystem. All studies, raw data files, model geometries, settings, and calculation artifacts reside within this directory.
- **Study**: A thematic research bundle within a workspace (for example, *Customer Satisfaction Study*). A study houses a primary dataset and one or more structural models.
- **Model**: A structural path diagram specifying latent variables, outer indicators (reflective Mode A or formative Mode B), structural hypotheses (directed edges), moderating interactions, quadratic paths, and Gaussian copulas.
- **Dataset**: A tabular data source (`.csv`, `.xlsx`, `.sav`) whose numerical columns are mapped to latent variable indicators.

---

## 2. Workspaces & Studies

### Creating or Opening a Workspace
- **Get Started Screen**: Upon launching StatSEM, you are greeted with the Get Started hub. You can:
  - Click **New Workspace** to select or create a directory on your computer.
  - Click **Open Folder** to link an existing StatSEM workspace directory.
  - Open a preconfigured sample project (e.g., *Corporate Reputation Model*).
- **Workspace Auto-Sync**: StatSEM monitors the workspace folder on disk. If external tools or Git branches modify files, StatSEM automatically harmonizes the state.

### Creating Studies
- Inside a workspace dashboard, click **+ New Study**.
- Enter a study name and choose the modeling methodology:
  - **PLS-SEM** *(Active)*: Variance-based Partial Least Squares path modeling.
  - **CB-SEM** *(Planned)*: Covariance-based maximum likelihood SEM.
  - **Regression** *(Planned)*: Classical ordinary least squares path regression.
- Once created, you can attach a dataset and create multiple model variations under the same study.

---

## 3. Tab Management System

StatSEM features a responsive tab bar located beneath the primary title bar:
- **Multiple Views Side-by-Side**: Keep your Dataset view, Model Editor, Snapshot inspections, and Documentation open simultaneously.
- **Tab Reordering**: Click and drag tabs horizontally to reorder your workspace layout.
- **Close & Navigation**: Click the close icon (`×`) on any tab or use `Ctrl/Cmd + W` to close the active tab.
- **Context Preservation**: Switching tabs preserves your zoom level, canvas pan coordinate, selection state, and active calculation table without requiring recalculations.

---

## 4. Dataset Import & Data Screening

### Supported Formats
- **Comma-Separated Values (`.csv`)**: Standard delimited files. Supports comma, semicolon, or tab delimiters.
- **Excel Workbooks (`.xlsx`)**: Reads the active or first worksheet.
- **SPSS Data Files (`.sav`)**: Imports variable labels, values, and missing value metadata.

### Data Screening Panel
StatSEM automatically screens imported indicators:
1. **Missing Data Inspection**: Highlights missing cells and displays percentage completeness per column. You can configure:
   - *Mean Value Replacement*: Imputes missing values using indicator series means.
   - *Listwise Deletion*: Removes records with any missing indicator value across the model.
   - *EM / Iterative Imputation*: Statistical expectation-maximization imputation.
2. **Descriptive Statistics**: Real-time computation of Mean, Standard Deviation, Skewness, Kurtosis, Minimum, and Maximum.
3. **Data Group Generation**: Create grouping variables (e.g., `Gender == 1` vs. `Gender == 2`, or median splits on age) for Multigroup Analysis (MGA).

---

## 5. The Graphical Model Editor

The canvas is an interactive vector environment engineered specifically for structural equation models.

### Canvas Navigation & Controls
- **Pan**: Click and drag on empty canvas background (or hold `Space` + drag).
- **Zoom**: Scroll your mouse wheel or trackpad pinch gesture. You can also use the zoom slider (`50%` to `200%`) or click **Fit to View** (`Ctrl/Cmd + 0`).
- **Grid Snapping**: Toggle the background grid and snap-to-grid behavior from the canvas toolbar.

### Creating Latent Constructs
- Click the **Add Latent Variable** icon (circle with a `+` inside) on the top toolbar or press `L`.
- Click anywhere on the canvas to place the variable.
- Type the construct name (e.g., `COMP`, `LIKE`, `CUSL`) and press `Enter`.
- Click on any construct to view its properties in the side inspector (toggle between **Reflective / Mode A** and **Formative / Mode B**).

### Assigning Manifest Indicators
- Select your latent variable.
- In the left **Variables Panel**, select one or more dataset columns.
- Drag them onto the latent variable, or double-click indicators to assign them.
- **Indicator Orientation**: Select the latent construct and use the orientation buttons in the floating toolbar to orient indicators to the **Left**, **Right**, **Top**, or **Bottom**.
- **Outer Loading Badges**: When results are computed, indicator arrows display outer loadings (reflective) or outer weights (formative) with collision avoidance so badges never obscure variable labels.

### Drawing Structural Paths
- Click the **Connect Path** tool (arrow icon) or press `P`.
- Click the source latent variable (independent / predictor construct).
- Click the target latent variable (dependent / outcome construct).
- An arrow connects the two constructs. The line geometry automatically computes the optimal docking perimeter around circular constructs.

### Moderating Effects (Interaction Terms)
To test whether construct $M$ moderates the relationship between predictor $X$ and target $Y$:
1. Ensure both $X \to Y$ and $M$ exist on the canvas.
2. Drag a connection from the moderator construct $M$ and drop it directly onto the **midpoint handle** of the $X \to Y$ structural path.
3. StatSEM automatically creates an interaction term $X \times M$ using the standardized **Two-Stage Approach**.
4. When multiple moderators target the same path, StatSEM staggers their midpoint landing dots to avoid overlaps.

### Nonlinear Quadratic Effects
To test for non-linear inverted-U or exponential curves ($X^2 \to Y$):
1. Hover over the source latent variable $X$.
2. Click the **Add Quadratic Effect (x²)** tool.
3. An accent-colored orthogonal departure route is spawned, passing through an interactive waypoint and connecting directly to the target path.
4. Drag the waypoint handle to customize the elbow curve while maintaining straight-line orthography.

### Gaussian Copula Endogeneity Assessment
To assess endogeneity without instrumental variables (Park & Gupta 2012):
1. Click the **Gaussian Copula (GC)** tool (circle with `GC` inside).
2. Connect it to the endogenous construct's structural path.
3. The engine computes the empirical CDF of the construct scores and inserts the copula control variable $C^* = \Phi^{-1}(F(Y))$.

### Intelligent Auto-Align & Layout Engine
If your canvas becomes cluttered:
- Click the **Auto-Align** button on the canvas toolbar.
- StatSEM's topological layout engine organizes constructs in causal layers (exogenous constructs on the left, mediators in the center, endogenous outcomes on the right).
- The layout engine calculates bounding boxes including all indicators and labels, ensuring that long path arrows (such as $X_1 \to Y_3$) route cleanly between constructs without cutting through construct text or badges.

### Customizing Styles, Borders, and Typography
- **Border Weight & Line Thickness**: Select any construct or path, click the line thickness selector in the toolbar, and either click `+`/`-` or type an exact pixel value (e.g. `2px`, `3px`) inline.
- **Font Sizes**: Adjust construct and indicator label font sizes inline without altering text-box dimensions or letter spacing.
- **Accent Color Harmonization**: Special arrows (Quadratic Effects, Gaussian Copula) adopt the workspace accent color with automatic palette history updates.
- **Text Boxes**: Add explanatory annotations anywhere on the canvas with customizable borders and background fills.

---

## 6. Calculation Engine & Workflows

### PLS-SEM Algorithm Runner
Click **Calculate > PLS-SEM Algorithm** from the top bar.
- **Weighting Schemes**:
  - *Path Weighting Scheme* (Recommended): Distinguishes between incoming and outgoing paths.
  - *Factor Weighting Scheme*: Uses bivariate correlations between constructs.
  - *Centroid Weighting Scheme*: Uses signs of correlations (Wold's original formulation).
- **Stop Criterion**: Iterations stop when relative change in outer weights is below $10^{-7}$ (or configured threshold, up to 300 maximum iterations).

### Parallel Bootstrapping
Click **Calculate > Bootstrapping** to compute empirical standard errors, $t$-statistics, and $p$-values.
- **Subsamples**: Select 5,000 (recommended for publication) or 10,000 samples.
- **Confidence Intervals**:
  - *Percentile Intervals*: Direct empirical quantiles ($\alpha/2$ and $1 - \alpha/2$).
  - *BCa (Bias-Corrected and Accelerated)*: Adjusts for both median bias and skewness.
  - *Studentized (Nested bootstrap)*: For complex non-normal parameter spaces.
- **Parallel Execution**: Uses multi-threaded worker pools to evaluate 5,000 resamples in seconds.

### Blindfolding (Predictive Relevance Q²)
Click **Calculate > Blindfolding** to evaluate Stone-Geisser's $Q^2$.
- **Omission Distance ($D$)**: Choose an omission distance between 5 and 10 (such that $N / D$ is not an integer).
- Computes both **Cross-Validated Redundancy** (structural model predictive relevance) and **Cross-Validated Communality** (measurement model fidelity).

### Multigroup Analysis (MGA) & Permutation Testing
Compare structural parameters across categorical data splits (e.g., Enterprise vs. SMB, Country A vs. Country B):
1. **MICOM Procedure**: Automated 3-step test for measurement invariance (Configural, Compositional, Equality of Means/Variances).
2. **Henseler's MGA Permutation Test**: Non-parametric permutation of group labels with empirical $p$-value distribution.
3. **Parametric & Welch-Satterthwaite Tests**: Hypothesis testing under equal or unequal subgroup variances.

---

## 7. Results Exploration & Model HUD

Once calculations complete, StatSEM opens the **Results View**:
- **Interactive Model HUD**: The path diagram displays calculated metrics directly:
  - Path coefficients ($\beta$) and $p$-values on structural arrows.
  - Coefficients of determination ($R^2$, adjusted $R^2$) inside endogenous construct nodes.
  - Outer loadings ($\lambda$) or weights ($w$) on indicator edges.
- **Tabular Diagnostics**:
  - *Path Coefficients*: Direct, indirect, and total effects with 95% confidence intervals.
  - *Construct Reliability & Validity*: Cronbach's $\alpha$, Dijkstra-Henseler $\rho_A$, Composite Reliability $\rho_C$, and AVE.
  - *Discriminant Validity*: Fornell-Larcker matrix, Cross-loadings, and HTMT / HTMT2 tables.
  - *Collinearity Statistics (VIF)*: Inner and outer variance inflation factors.
  - *Model Fit Indices*: SRMR, d_ULS, d_G, and Chi-square diagnostics.

---

## 8. Snapshots & Model Versioning

StatSEM allows you to capture the entire state of your research model at any milestone:
- **Save Snapshot**: Click **Save Snapshot** in the model editor or results sub-header.
- **Snapshot Contents**: A snapshot preserves the model canvas geometry, node coordinates, indicator positions, dataset linkage, algorithm settings, and complete computed matrices.
- **Snapshot Explorer**: Browse historical snapshots in the dedicated Snapshot tab. Switch between visual diagram views and tabular metrics without re-running calculations.
- **High-Contrast Snapshot Rendering**: Endogenous construct nodes render with white $R^2$ text, and all specialized effects (QE and GC) are faithfully captured.

---

## 9. Exporting Diagrams & Comprehensive Reports

### Diagram Export Options
From either the Model Editor or Snapshot View, click **Export Diagram**:
- **Format**: High-resolution PNG or vector SVG.
- **Resolution**: 1x, 2x, 3x (300 DPI publication quality).
- **Background**: Transparent, Solid Canvas Theme, or High-Contrast Black & White.
- In Black & White mode, arrow line widths are kept consistent with standard vector thickness rather than inflated strokes.

### Comprehensive Results Export
From the Results screen sub-header, click **Export All**:
- **Export All Tables as CSV / Excel**: Generates a multi-sheet spreadsheet containing every diagnostic table.
- **Export HTML Report**: A self-contained, interactive HTML dossier with embedded SVG diagrams.
- **Export PDF Report**: Formatted print-ready manuscript report with executive summaries and diagnostic checklists.
- **SEMinR R-Script Export**: Export your complete model as executable R code using the `seminr` library for verification.

---

## 10. Keyboard Shortcuts & Productivity Tips

| Action | macOS Shortcut | Windows / Linux Shortcut |
| :--- | :--- | :--- |
| **New Latent Variable** | `L` | `L` |
| **Connect Path** | `P` | `P` |
| **Select / Move** | `V` or `Escape` | `V` or `Escape` |
| **Delete Selected** | `Backspace` or `Delete` | `Delete` |
| **Fit to View** | `Cmd + 0` | `Ctrl + 0` |
| **Zoom In / Out** | `Cmd + +` / `Cmd + -` | `Ctrl + +` / `Ctrl + -` |
| **Close Active Tab** | `Cmd + W` | `Ctrl + W` |
| **Save Snapshot** | `Cmd + S` | `Ctrl + S` |
| **Run PLS-SEM** | `Cmd + Enter` | `Ctrl + Enter` |
| **Toggle Dark/Light Mode** | `Cmd + Shift + D` | `Ctrl + Shift + D` |

---
*StatSEM Documentation — High-Performance Structural Equation Modeling.*

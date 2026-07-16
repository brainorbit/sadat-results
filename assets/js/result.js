/**
 * result.js — renders the full result page from URL params + exam JSON.
 * URL shape: result.html?year=2026&file=test-1.json&reg=2023123456
 */
(() => {
  const params = new URLSearchParams(window.location.search);
  const examYear = params.get("year");
  const fileName = params.get("file");
  const registration = params.get("reg");

  const skeletonWrap = Utils.qs("#skeletonWrap");
  const errorState = Utils.qs("#errorState");
  const resultContent = Utils.qs("#resultContent");
  const actionBar = Utils.qs("#actionBar");

  function showError(title, desc) {
    skeletonWrap.hidden = true;
    resultContent.hidden = true;
    actionBar.hidden = true;
    errorState.hidden = false;
    Utils.qs("#errorTitle").textContent = title;
    Utils.qs("#errorDesc").textContent = desc;
  }

  async function init() {
    if (!examYear || !fileName || !registration) {
      showError("Missing search details", "Please start a new search from the homepage.");
      return;
    }

    let exam;
    try {
      exam = await Data.loadExamFile(examYear, fileName);
    } catch (e) {
      console.error(e);
      showError("Couldn't load result data", "There was a problem reaching the result records. Please try again.");
      return;
    }

    const student = Data.findStudent(exam, registration);
    if (!student) {
      showError("Result not found", `No student with registration ${registration} was found for this exam.`);
      return;
    }

    render(exam, student);
  }

  function render(exam, student) {
    const { rows, sgpaMode, theorySubjects, totalFullMarks } = Utils.buildLeaderboard(exam);
    const myRow = rows.find(r => r.student.registration === student.registration);
    const totalStudents = rows.length;

    const scores = rows.map(r => r.score);
    const highestScore = Math.max(...scores);
    const avgScore = Utils.average(scores);
    const topRow = rows.find(r => r.score === highestScore);

    const allTotals = rows.map(r => r.totalMarks);
    const avgTotalMarks = Utils.average(allTotals);
    const highestTotalRow = rows.find(r => r.totalMarks === Math.max(...allTotals));

    const betterThanCount = rows.filter(r => r.score < myRow.score).length;
    const percentile = totalStudents > 1
      ? Utils.round((betterThanCount / (totalStudents - 1)) * 100, 0)
      : 100;

    const hasFail = exam.subjects.some(sub => {
      const marks = student.marks[sub.code];
      return marks !== undefined && Utils.gradeFor(marks, sub.fullMarks || 100).grade === "F";
    });
    const resultStatus = hasFail ? "Fail" : "Pass";

    renderStudentCard(exam, student, myRow, sgpaMode, resultStatus, totalStudents);
    renderMetaStrip(exam);
    renderSubjectTable(exam, student);
    renderStats({ myRow, sgpaMode, avgScore, highestScore, topRow, totalStudents, avgTotalMarks, highestTotalRow, percentile, totalFullMarks });
    renderCompare(exam, rows, student);
    renderChart(exam, theorySubjects, rows, student);
    buildPrintCard(exam, student, myRow, sgpaMode, resultStatus);

    skeletonWrap.hidden = true;
    resultContent.hidden = false;
    actionBar.hidden = false;

    wireActions(exam, student);
  }

  function initials(name) {
    return name.split(" ").filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join("");
  }

  function renderStudentCard(exam, student, myRow, sgpaMode, resultStatus, totalStudents) {
    const wrap = Utils.qs("#studentCard");
    wrap.innerHTML = "";

    const idBlock = Utils.el("div", { class: "student-id" }, [
      Utils.el("div", { class: "avatar-ring", text: initials(student.name) }),
      Utils.el("div", {}, [
        Utils.el("h1", { class: "student-name", text: student.name }),
        Utils.el("div", { class: "student-meta" }, [
          Utils.el("span", { text: `Reg: ${student.registration}` }),
          Utils.el("span", { text: `· Rank ${myRow.rank}/${totalStudents}` })
        ])
      ])
    ]);

    const rightBlock = Utils.el("div", { class: "gpa-block" }, []);

    if (sgpaMode && myRow.sgpaResult) {
      rightBlock.appendChild(buildGradeRing(myRow.sgpaResult.sgpa));
    } else {
      const noSgpa = Utils.el("div", {}, []);
      noSgpa.appendChild(Utils.el("div", { class: "gpa-text-label", text: "SGPA Not Available" }));
      rightBlock.appendChild(noSgpa);
    }

    const statusPill = Utils.el("span", {
      class: `status-pill ${resultStatus === "Pass" ? "status-pass" : "status-fail"}`,
      text: resultStatus
    });
    rightBlock.appendChild(statusPill);

    wrap.appendChild(idBlock);
    wrap.appendChild(rightBlock);
  }

  function buildGradeRing(sgpa) {
    const pct = Math.max(0, Math.min(1, sgpa / 4));
    const circumference = 251.2;
    const offset = circumference - pct * circumference;

    const wrap = Utils.el("div", { class: "grade-ring-wrap" }, []);
    wrap.innerHTML = `
      <svg viewBox="0 0 90 90">
        <circle class="ring-track" cx="45" cy="45" r="40"></circle>
        <circle class="ring-progress" cx="45" cy="45" r="40" style="stroke-dashoffset:${circumference}"></circle>
      </svg>
      <div class="ring-label">
        <span class="ring-value">${sgpa.toFixed(2)}</span>
        <span class="ring-caption">SGPA</span>
      </div>`;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        wrap.querySelector(".ring-progress").style.strokeDashoffset = offset;
      });
    });
    return wrap;
  }

  function renderMetaStrip(exam) {
    const strip = Utils.qs("#metaStrip");
    strip.innerHTML = "";
    const items = [
      ["Exam", exam.examName],
      ["Exam Year", exam.examYear],
      ["Academic Year", exam.academicYear],
      ["Department", CONFIG.departmentName]
    ];
    items.forEach(([label, value]) => {
      strip.appendChild(Utils.el("div", { class: "meta-item" }, [
        Utils.el("div", { class: "meta-item-label", text: label }),
        Utils.el("div", { class: "meta-item-value", text: String(value) })
      ]));
    });
  }

  function renderSubjectTable(exam, student) {
    const tbody = Utils.qs("#subjectTableBody");
    tbody.innerHTML = "";
    Utils.qs("#subjectCount").textContent = `${exam.subjects.length} subjects`;

    exam.subjects.forEach((sub, i) => {
      const marks = student.marks[sub.code] ?? 0;
      const fullMarks = sub.fullMarks || 100;
      const g = Utils.gradeFor(marks, fullMarks);
      const tr = Utils.el("tr", { class: "stagger" });
      tr.style.setProperty("--i", i);

      const nameCell = Utils.el("td", {}, [
        Utils.el("div", { class: "subj-name-cell" }, [
          Utils.el("span", { class: "subj-code", text: sub.code }),
          Utils.el("span", { class: "subj-name", text: sub.name })
        ])
      ]);

      const marksCell = Utils.el("td", { class: "num", text: `${marks} / ${fullMarks}` });

      const chipClass = g.grade === "F" ? "grade-fail" : (g.grade === "A+" ? "grade-top" : "");
      const gradeCell = Utils.el("td", { class: "num" }, [
        Utils.el("span", { class: `grade-chip ${chipClass}`, text: g.grade })
      ]);

      const pointCell = Utils.el("td", { class: "num", text: g.point.toFixed(2) });
      const creditCell = Utils.el("td", { class: "num", text: String(sub.credit) });

      tr.appendChild(nameCell);
      tr.appendChild(marksCell);
      tr.appendChild(gradeCell);
      tr.appendChild(pointCell);
      tr.appendChild(creditCell);
      tbody.appendChild(tr);
    });
  }

  function statTile(label, value, sub, i, highlight) {
    const tile = Utils.el("div", { class: `stat-tile stagger${highlight ? " highlight" : ""}` });
    tile.style.setProperty("--i", i);
    tile.appendChild(Utils.el("div", { class: "stat-tile-label", text: label }));
    tile.appendChild(Utils.el("div", { class: "stat-tile-value", text: value }));
    if (sub) tile.appendChild(Utils.el("div", { class: "stat-tile-sub", text: sub }));
    return tile;
  }

  function renderStats({ myRow, sgpaMode, avgScore, highestScore, topRow, totalStudents, avgTotalMarks, highestTotalRow, percentile, totalFullMarks }) {
    const grid = Utils.qs("#statsGrid");
    grid.innerHTML = "";
    let i = 0;

    grid.appendChild(statTile("Overall Rank", `#${myRow.rank}`, `of ${totalStudents} students`, i++));
    grid.appendChild(statTile("Highest Marks", highestTotalRow.student.name, `${highestTotalRow.totalMarks} / ${totalFullMarks} marks`, i++));
    grid.appendChild(statTile("Average Marks", `${Utils.round(avgTotalMarks, 1)} / ${totalFullMarks}`, "class total average", i++));

    if (sgpaMode) {
      grid.appendChild(statTile("Highest SGPA", highestScore.toFixed(2), topRow.student.name, i++, true));
      grid.appendChild(statTile("Your SGPA", myRow.sgpaResult ? myRow.sgpaResult.sgpa.toFixed(2) : "—", null, i++, true));
      grid.appendChild(statTile("Department Average", avgScore.toFixed(2), "SGPA", i++));
    } else {
      grid.appendChild(statTile("Highest Total Marks", `${highestScore.toFixed(0)} / ${totalFullMarks}`, topRow.student.name, i++, true));
      grid.appendChild(statTile("Your Total Marks", `${myRow.totalMarks.toFixed(0)} / ${totalFullMarks}`, null, i++, true));
      grid.appendChild(statTile("Department Average", avgScore.toFixed(1), "total marks", i++));
    }

    const banner = Utils.qs("#percentileBanner");
    banner.innerHTML = `You performed better than <strong>${percentile}%</strong> of students in this exam.`;
  }

  function renderCompare(exam, rows, student) {
    const list = Utils.qs("#compareList");
    list.innerHTML = "";

    exam.subjects.forEach((sub, i) => {
      const fullMarks = sub.fullMarks || 100;
      const allMarks = rows.map(r => r.student.marks[sub.code] ?? 0);
      const you = student.marks[sub.code] ?? 0;
      const highest = Math.max(...allMarks);
      const avg = Utils.average(allMarks);
      const diff = Utils.round(you - avg, 1);

      const item = Utils.el("div", { class: "compare-item stagger" });
      item.style.setProperty("--i", i);

      item.innerHTML = `
        <div class="compare-head">
          <div>
            <div class="compare-title">${escapeHtml(sub.name)}</div>
            <div class="compare-code">${escapeHtml(sub.code)}</div>
          </div>
          <div class="compare-diff ${diff >= 0 ? "pos" : "neg"}">${diff >= 0 ? "+" : ""}${diff}</div>
        </div>
        <div class="compare-rows">
          ${compareRow("You", you, "you", fullMarks)}
          ${compareRow("Highest", highest, "top", fullMarks)}
          ${compareRow("Average", Utils.round(avg, 1), "avg", fullMarks)}
        </div>`;
      list.appendChild(item);
    });

    // animate bars after insertion
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        Utils.qsa(".bar-fill").forEach(bar => {
          const val = parseFloat(bar.dataset.value || "0");
          bar.style.width = `${Math.min(100, val)}%`;
        });
      });
    });
  }

  function compareRow(label, value, cls, fullMarks = 100) {
    const pct = Utils.percentageFor(value, fullMarks);
    return `
      <div class="compare-row">
        <span class="compare-row-label">${label}</span>
        <div class="bar-track"><div class="bar-fill ${cls}" data-value="${pct}"></div></div>
        <span class="compare-row-val">${value}</span>
      </div>`;
  }

  function escapeHtml(str) {
    const d = document.createElement("div");
    d.textContent = str;
    return d.innerHTML;
  }

  function renderChart(exam, theorySubjects, rows, student) {
    const canvas = Utils.qs("#radarChart");
    if (!theorySubjects.length) {
      canvas.closest(".chart-card").hidden = true;
      return;
    }
    const labels = theorySubjects.map(s => s.name);
    const you = theorySubjects.map(s => Utils.percentageFor(student.marks[s.code] ?? 0, s.fullMarks || 100));
    const avg = theorySubjects.map(s => Utils.average(rows.map(r => Utils.percentageFor(r.student.marks[s.code] ?? 0, s.fullMarks || 100))));
    RadarChart.draw(canvas, { labels, you, avg, max: 100 });
  }

  // ---------------- Printable / downloadable marksheet ----------------

  function buildPrintCard(exam, student, myRow, sgpaMode, resultStatus) {
    const card = Utils.qs("#printCard");
    const rows = exam.subjects.map(sub => {
      const marks = student.marks[sub.code] ?? 0;
      const fullMarks = sub.fullMarks || 100;
      const g = Utils.gradeFor(marks, fullMarks);
      return `
        <tr>
          <td><span class="code">${escapeHtml(sub.code)}</span>${escapeHtml(sub.name)}</td>
          <td class="num">${marks} / ${fullMarks}</td>
          <td class="num">${g.grade}</td>
          <td class="num">${g.point.toFixed(2)}</td>
          <td class="num">${sub.credit}</td>
        </tr>`;
    }).join("");

    card.innerHTML = `
      <div class="pc-header">
        <div class="pc-mark" aria-hidden="true">
          <img src="assets/images/logo.png" alt="" width="46" height="46">
        </div>
        <div>
          <div class="pc-uni">${escapeHtml(CONFIG.universityName)}</div>
          <div class="pc-dept">${escapeHtml(CONFIG.departmentName)}</div>
        </div>
        <div class="pc-doctitle">
          <div class="t2">Generated ${Utils.formatDate()}</div>
        </div>
      </div>

      <div class="pc-grid">
        <div><div class="pc-field-label">Student Name</div><div class="pc-field-value">${escapeHtml(student.name)}</div></div>
        <div><div class="pc-field-label">Registration No.</div><div class="pc-field-value">${escapeHtml(student.registration)}</div></div>
        <div><div class="pc-field-label">Academic Year</div><div class="pc-field-value">${escapeHtml(exam.academicYear)}</div></div>
        <div><div class="pc-field-label">Exam</div><div class="pc-field-value">${escapeHtml(exam.examName)} (${exam.examYear})</div></div>
      </div>

      <div class="pc-status-row">
        <div>
          <div class="pc-field-label">Result Status</div>
          <div class="pc-field-value" style="color:${resultStatus === "Pass" ? "#1E8E3E" : "#D93025"}">${resultStatus}</div>
        </div>
        ${sgpaMode && myRow.sgpaResult ? `
        <div class="pc-sgpa-box">
          <div class="v">${myRow.sgpaResult.sgpa.toFixed(2)}</div>
          <div class="l">SGPA</div>
        </div>` : `
        <div class="pc-sgpa-box">
          <div class="v" style="font-size:15px;color:#6E6E73">N/A</div>
          <div class="l">SGPA Not Available</div>
        </div>`}
      </div>

      <table class="pc-table">
        <thead>
          <tr><th>Subject</th><th class="num">Marks</th><th class="num">Grade</th><th class="num">Point</th><th class="num">Credit</th></tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>

      <div class="pc-footer">
        <div>${escapeHtml(CONFIG.departmentName)} · ${escapeHtml(CONFIG.universityName)}</div>
      </div>`;
  }

  function wireActions(exam, student) {
    Utils.qs("#downloadBtn").addEventListener("click", async (e) => {
      const btn = e.currentTarget;
      const originalHtml = btn.innerHTML;
      btn.disabled = true;
      btn.innerHTML = `<span class="spinner" style="border-top-color:#1a1200;border-color:rgba(26,18,0,0.35)"></span> Generating…`;

      try {
        const card = Utils.qs("#printCard");
        const canvas = await html2canvas(card, { scale: 2, backgroundColor: "#ffffff", width: card.offsetWidth, height: card.offsetHeight });

        const link = document.createElement("a");
        link.download = `${student.registration}-${exam.examName.replace(/\s+/g, "-")}.png`;
        link.href = canvas.toDataURL("image/png");
        link.click();
      } catch (err) {
        console.error(err);
        alert("Couldn't generate the image. Please try the Print option instead.");
      } finally {
        btn.disabled = false;
        btn.innerHTML = originalHtml;
      }
    });
  }

  init();
})();

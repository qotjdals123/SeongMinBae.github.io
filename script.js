const DATA_URL = './data.json';

const menuButton = document.querySelector('.menu-button');
const primaryNav = document.querySelector('.primary-nav');
const navLinks = [...document.querySelectorAll('.primary-nav a[href^="#"]')];
const yearElement = document.querySelector('#current-year');
const PROJECT_MODAL_HISTORY_KEY = 'projectModalOpen';
const TIMELINE_MODAL_HISTORY_KEY = 'careerTimelineModalOpen';

let resumeData = null;
let careerRefreshTimer = null;
let projectModal = null;
let projectModalCloseTimer = null;
let lastFocusedElement = null;
let careerTimelineModal = null;
let careerTimelineCloseTimer = null;
let careerTimelineResizeTimer = null;
let timelineLastFocusedElement = null;

if (yearElement) {
  yearElement.textContent = new Date().getFullYear();
}

function closeMenu() {
  if (!menuButton || !primaryNav) return;
  menuButton.setAttribute('aria-expanded', 'false');
  primaryNav.classList.remove('open');
  document.body.classList.remove('menu-open');
}

menuButton?.addEventListener('click', () => {
  const expanded = menuButton.getAttribute('aria-expanded') === 'true';
  menuButton.setAttribute('aria-expanded', String(!expanded));
  primaryNav?.classList.toggle('open', !expanded);
  document.body.classList.toggle('menu-open', !expanded);
});

navLinks.forEach((link) => link.addEventListener('click', closeMenu));

document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;

  closeMenu();

  if (careerTimelineModal && !careerTimelineModal.hidden) {
    closeCareerTimelineModal();
  }
});

window.addEventListener('resize', () => {
  if (window.innerWidth > 720) closeMenu();

  if (careerTimelineModal && !careerTimelineModal.hidden) {
    clearTimeout(careerTimelineResizeTimer);
    careerTimelineResizeTimer = window.setTimeout(
      drawCareerTimelineCanvas,
      120
    );
  }
});

function createElement(tagName, className, text) {
  const element = document.createElement(tagName);
  if (className) element.className = className;
  if (text !== undefined && text !== null) element.textContent = text;
  return element;
}

function replaceChildren(target, children) {
  if (!target) return;
  target.replaceChildren(...children);
}

function getLocalToday() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function parseDate(value) {
  if (!value) return null;

  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    throw new Error(`날짜 형식이 올바르지 않습니다: ${value}`);
  }

  const [, year, month, day] = match.map(Number);
  const date = new Date(year, month - 1, day);

  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    throw new Error(`존재하지 않는 날짜입니다: ${value}`);
  }

  return date;
}

function addDays(date, days) {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

function getDateDiff(startDate, endDate) {
  let years = endDate.getFullYear() - startDate.getFullYear();
  let months = endDate.getMonth() - startDate.getMonth();
  let days = endDate.getDate() - startDate.getDate();

  if (days < 0) {
    const previousMonthLastDay = new Date(
      endDate.getFullYear(),
      endDate.getMonth(),
      0
    ).getDate();
    days += previousMonthLastDay;
    months -= 1;
  }

  if (months < 0) {
    months += 12;
    years -= 1;
  }

  return { years, months, days };
}

function calculateTotalCareer(experienceItems, today = getLocalToday()) {
  const intervals = experienceItems
    .map((item) => {
      const start = parseDate(item.startDate);
      const end = item.endDate ? parseDate(item.endDate) : today;

      if (end < start) {
        throw new Error(`${item.company}의 종료일이 시작일보다 빠릅니다.`);
      }

      return { start, end };
    })
    .sort((a, b) => a.start - b.start);

  if (intervals.length === 0) {
    return { years: 0, months: 0, days: 0 };
  }

  const merged = [];

  intervals.forEach((interval) => {
    const last = merged.at(-1);

    if (!last || interval.start > addDays(last.end, 1)) {
      merged.push({ ...interval });
      return;
    }

    if (interval.end > last.end) {
      last.end = interval.end;
    }
  });

  const millisecondsPerDay = 24 * 60 * 60 * 1000;
  const totalDays = merged.reduce((sum, interval) => {
    const utcStart = Date.UTC(
      interval.start.getFullYear(),
      interval.start.getMonth(),
      interval.start.getDate()
    );
    const utcEnd = Date.UTC(
      interval.end.getFullYear(),
      interval.end.getMonth(),
      interval.end.getDate()
    );

    return sum + Math.floor((utcEnd - utcStart) / millisecondsPerDay);
  }, 0);

  const anchor = merged[0].start;
  return getDateDiff(anchor, addDays(anchor, totalDays));
}

function formatCareerDuration(duration) {
  return `${duration.years}년 ${duration.months}개월 ${duration.days}일`;
}

function formatExperiencePeriod(item) {
  const start = item.startDate.replaceAll('-', '.');
  const end = item.endDate ? item.endDate.replaceAll('-', '.') : '';
  if(item.title == 'IT병역특례 전역'){
    return `${start}`;
  }else{
    return end ? `${start} ~ ${end}` : `${start} ~`;  
  }
}

function updateCareerDuration() {
  if (!resumeData?.experience) return;

  const totalCareer = formatCareerDuration(
    calculateTotalCareer(resumeData.experience)
  );

  const summaryValue = document.querySelector('[data-summary="total-career"]');
  if (summaryValue) summaryValue.textContent = totalCareer;

  const careerSummary = document.querySelector('#career-summary');
  if (careerSummary) careerSummary.textContent = `총 경력 ${totalCareer}`;
}

function scheduleCareerRefresh() {
  if (careerRefreshTimer) clearTimeout(careerRefreshTimer);

  const now = new Date();
  const nextMidnight = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() + 1,
    0,
    0,
    1
  );

  careerRefreshTimer = window.setTimeout(() => {
    updateCareerDuration();
    updateBirthAge();
    scheduleCareerRefresh();
  }, nextMidnight.getTime() - now.getTime());
}

function renderProfile(profile, site) {
  document.title = site?.title || document.title;

  const name = document.querySelector('[data-profile="name"]');
  const role = document.querySelector('[data-profile="role"]');
  const description = document.querySelector('[data-profile="description"]');
  const brandElements = document.querySelectorAll('.brand');

  if (name) name.textContent = profile.name;
  if (role) role.textContent = profile.role;
  if (description) description.textContent = profile.description;
  brandElements.forEach((brand) => {
    brand.textContent = site?.brand || 'BAELAB';
  });

  const summaryItems = [
    { label: '총 경력', value: '', key: 'total-career' },
    { label: '현 소속', value: profile.currentPosition },
    { label: '출생년월', value: '', key: 'birth' },
    { label: '학력', value: profile.educationSummary, multiple: true },
    { label: '이메일', value: profile.email, email: true }
  ];
  
  const summaryChildren = summaryItems.map((item) => {
    const row = createElement('div');
    const term = createElement('dt', '', item.label);
    const detail = createElement('dd');

    if (item.key) {
      detail.dataset.summary = item.key;
    }

    if (item.multiple){
      detail.classList.add('education-summary');
    }
    
    if (item.email) {
      const link = createElement('a', '', item.value);
      link.href = `mailto:${item.value}`;
      detail.append(link);
    } else {
      detail.textContent = item.value;
    }

    row.append(term, detail);
    return row;
  });

  replaceChildren(document.querySelector('#summary-list'), summaryChildren);
  
  const contactEmail = document.querySelector('#contact-email');
  if (contactEmail) {
    contactEmail.textContent = profile.email;
    contactEmail.href = `mailto:${profile.email}`;
  }

  updateBirthAge();
}

function renderEducation(items) {
  const children = items.map((item) => {
    const article = createElement('article', 'record-item');
    const period = createElement('p', 'record-period', item.period);
    const content = createElement('div', 'record-content');

    content.append(
      createElement('h3', '', item.school),
      createElement('p', '', item.major)
    );

    if (item.note) {
      content.append(createElement('span', 'record-note', item.note));
    }

    article.append(period, content);
    return article;
  });

  replaceChildren(document.querySelector('#education-list'), children);
}

function createProjectModal() {
  if (projectModal) return projectModal;

  const modal = createElement('div', 'project-modal');
  modal.hidden = true;
  modal.setAttribute('aria-hidden', 'true');

  const backdrop = createElement('div', 'project-modal__backdrop');
  backdrop.dataset.modalClose = 'true';

  const dialog = createElement('section', 'project-modal__dialog');
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('aria-labelledby', 'project-modal-title');
  dialog.setAttribute('aria-describedby', 'project-modal-subtitle');
  dialog.tabIndex = -1;

  const header = createElement('header', 'project-modal__header');
  const headingArea = createElement('div', 'project-modal__heading');
  const eyebrow = createElement('p', 'project-modal__eyebrow', 'CAREER DETAILS');
  const title = createElement('h2', '', '경력 상세 내역');
  title.id = 'project-modal-title';
  const subtitle = createElement('p', '', '');
  subtitle.id = 'project-modal-subtitle';
  headingArea.append(eyebrow, title, subtitle);

  const closeButton = createElement('button', 'project-modal__close');
  closeButton.type = 'button';
  closeButton.setAttribute('aria-label', '경력 상세 팝업 닫기');
  closeButton.innerHTML = '<span aria-hidden="true"></span>';
  closeButton.dataset.modalClose = 'true';

  header.append(headingArea, closeButton);

  const body = createElement('div', 'project-modal__body');
  body.id = 'project-modal-body';

  dialog.append(header, body);
  modal.append(backdrop, dialog);
  document.body.append(modal);

  modal.addEventListener('click', (event) => {
    if (event.target.closest('[data-modal-close="true"]')) {
      closeProjectModal();
    }
  });

  modal.addEventListener('keydown', (event) => {
    if (event.key !== 'Tab') return;

    const focusableElements = [...modal.querySelectorAll(
      'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )].filter((element) => !element.hidden && element.offsetParent !== null);

    if (focusableElements.length === 0) {
      event.preventDefault();
      dialog.focus();
      return;
    }

    const firstElement = focusableElements[0];
    const lastElement = focusableElements.at(-1);

    if (event.shiftKey && document.activeElement === firstElement) {
      event.preventDefault();
      lastElement.focus();
    } else if (!event.shiftKey && document.activeElement === lastElement) {
      event.preventDefault();
      firstElement.focus();
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && projectModal && !projectModal.hidden) {
      closeProjectModal();
    }
  });

  projectModal = modal;
  return modal;
}

function normalizeCareerDetailGroups(item) {
  const detailSource = item.projectDetails;

  if (Array.isArray(detailSource)) {
    return [
      {
        key: 'projects',
        label: '수행 프로젝트',
        items: detailSource
      },
      {
        key: 'programOperations',
        label: '시스템 운영 경험',
        items: []
      },
      {
        key: 'solutionOperations',
        label: '솔루션 운영 및 관리 경험',
        items: []
      }
    ];
  }

  return [
    {
      key: 'projects',
      label: '수행 프로젝트',
      items: Array.isArray(detailSource?.projects)
        ? detailSource.projects
        : []
    },
    {
      key: 'programOperations',
      label: '프로그램 운영 경험',
      items: Array.isArray(detailSource?.programOperations)
        ? detailSource.programOperations
        : []
    },
    {
      key: 'solutionOperations',
      label: '솔루션 운영 및 관리 경험',
      items: Array.isArray(detailSource?.solutionOperations)
        ? detailSource.solutionOperations
        : []
    }
  ];
}

function createCareerDetailCard(detail) {
  const article = createElement('article', 'project-detail-card');
  const cardHeader = createElement('div', 'project-detail-card__header');
  const cardHeading = createElement('div');
  const detailTitle = createElement('h4', '', detail.title || '상세 내역');
  cardHeading.append(detailTitle);

  if (detail.summary) {
    cardHeading.append(
      createElement('p', 'project-detail-card__summary', detail.summary)
    );
  }

  cardHeader.append(cardHeading);

  if (detail.period) {
    cardHeader.append(
      createElement('span', 'project-detail-card__period', detail.period)
    );
  }

  article.append(cardHeader);

  const metaItems = [];
  if (detail.role) metaItems.push({ label: '역할', value: detail.role });
  if (detail.client) metaItems.push({ label: '대상', value: detail.client });

  if (metaItems.length > 0) {
    const meta = createElement('dl', 'project-detail-card__meta');
    metaItems.forEach((metaItem) => {
      const group = createElement('div');
      group.append(
        createElement('dt', '', metaItem.label),
        createElement('dd', '', metaItem.value)
      );
      meta.append(group);
    });
    article.append(meta);
  }

  return article;
}

function createCareerDetailGroup(group, index) {
  const section = createElement(
    'section',
    `career-detail-group career-detail-group--${group.key}`
  );
  const heading = createElement('header', 'career-detail-group__heading');
  const headingText = createElement('div', 'career-detail-group__title');
  const number = createElement(
    'span',
    'career-detail-group__number',
    String(index + 1).padStart(2, '0')
  );
  const title = createElement('h3', '', group.label);
  const count = createElement(
    'span',
    'career-detail-group__count',
    `${group.items.length}건`
  );

  headingText.append(number, title);
  heading.append(headingText, count);
  section.append(heading);

  const list = createElement('div', 'career-detail-group__list');

  if (group.items.length > 0) {
    group.items.forEach((detail) => {
      list.append(createCareerDetailCard(detail));
    });
  } else {
    const empty = createElement('p', 'career-detail-group__empty');
    empty.textContent = '등록된 내역이 없습니다.';
    list.append(empty);
  }

  section.append(list);
  return section;
}

function renderProjectModalContent(item) {
  const modal = createProjectModal();
  const title = modal.querySelector('#project-modal-title');
  const subtitle = modal.querySelector('#project-modal-subtitle');
  const body = modal.querySelector('#project-modal-body');

  title.textContent = `${item.company} 경력 상세 내역`;
  subtitle.textContent = `${item.position} · ${formatExperiencePeriod(item)}`;

  const groups = normalizeCareerDetailGroups(item);
  const hasRegisteredDetail = groups.some((group) => group.items.length > 0);

  if (!hasRegisteredDetail && Array.isArray(item.duties) && item.duties.length > 0) {
    groups[0].items.push({
      title: '주요 수행 업무',
      tasks: item.duties
    });
  }

  body.replaceChildren(
    ...groups.map((group, index) => createCareerDetailGroup(group, index))
  );
}

function openProjectModal(item, triggerElement) {
  const modal = createProjectModal();

  if (projectModalCloseTimer) {
    clearTimeout(projectModalCloseTimer);
    projectModalCloseTimer = null;
  }

  renderProjectModalContent(item);
  lastFocusedElement = triggerElement || document.activeElement;

  // 팝업이 처음 열릴 때만 방문 기록 한 단계 추가
  if (!history.state?.[PROJECT_MODAL_HISTORY_KEY]) {
    history.pushState(
      {
        ...(history.state || {}),
        [PROJECT_MODAL_HISTORY_KEY]: true
      },
      '',
      window.location.href
    );
  }

  modal.hidden = false;
  modal.setAttribute('aria-hidden', 'false');
  document.body.classList.add('modal-open');

  window.requestAnimationFrame(() => {
    modal.classList.add('is-open');
    modal.querySelector('.project-modal__close')?.focus();
  });
}

function hideProjectModal() {
  if (!projectModal || projectModal.hidden) return;

  projectModal.classList.remove('is-open');
  projectModal.setAttribute('aria-hidden', 'true');
  if (!careerTimelineModal || careerTimelineModal.hidden) {
    document.body.classList.remove('modal-open');
  }

  projectModalCloseTimer = window.setTimeout(() => {
    projectModal.hidden = true;
    projectModalCloseTimer = null;
    lastFocusedElement?.focus();
  }, 180);
}

function closeProjectModal({ fromHistory = false } = {}) {
  if (!projectModal || projectModal.hidden) return;

  /*
   * 닫기 버튼·배경·ESC로 닫는 경우:
   * 팝업을 열면서 추가한 history를 먼저 제거합니다.
   * popstate 이벤트에서 실제 팝업이 닫힙니다.
   */
  if (
    !fromHistory &&
    history.state?.[PROJECT_MODAL_HISTORY_KEY]
  ) {
    history.back();
    return;
  }

  hideProjectModal();
}


function formatTimelineMonth(dateValue) {
  const date = parseDate(dateValue);
  return `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function getTimelineItems(items) {
  return items.map((item) => {
    const hasPositions =
      Array.isArray(item.positions) &&
      item.positions.length > 0;

    const sourcePositions = hasPositions
      ? item.positions
      : [
          {
            title: item.position || '',
            type: '',
            startDate: item.startDate,
            endDate: item.endDate
          }
        ];

    const segments = sourcePositions
      .map((position) => {
        const startDate =
          position.startDate ||
          item.startDate;

        const endDate =
          position.endDate === undefined
            ? item.endDate ?? null
            : position.endDate;

        return {
          title:
            position.title ||
            item.position ||
            '',
          type: position.type || '',
          startDate,
          endDate,
          isMilestone:
            Boolean(startDate) &&
            Boolean(endDate) &&
            startDate === endDate
        };
      })
      .filter((position) => position.startDate)
      .sort(
        (first, second) =>
          parseDate(second.startDate) -
          parseDate(first.startDate)
      );

    return {
      company: item.company,
      position: item.position || '',
      status: item.status || '',
      startDate: item.startDate,
      endDate: item.endDate,
      segments
    };
  });
}

function drawCanvasRoundRect(
  context,
  x,
  y,
  width,
  height,
  radius
) {
  const safeRadius = Math.min(
    radius,
    width / 2,
    height / 2
  );

  context.beginPath();
  context.moveTo(x + safeRadius, y);
  context.lineTo(
    x + width - safeRadius,
    y
  );
  context.quadraticCurveTo(
    x + width,
    y,
    x + width,
    y + safeRadius
  );
  context.lineTo(
    x + width,
    y + height - safeRadius
  );
  context.quadraticCurveTo(
    x + width,
    y + height,
    x + width - safeRadius,
    y + height
  );
  context.lineTo(
    x + safeRadius,
    y + height
  );
  context.quadraticCurveTo(
    x,
    y + height,
    x,
    y + height - safeRadius
  );
  context.lineTo(x, y + safeRadius);
  context.quadraticCurveTo(
    x,
    y,
    x + safeRadius,
    y
  );
  context.closePath();
}

function fitCanvasText(
  context,
  text,
  maxWidth
) {
  const normalizedText = text || '';

  if (
    context.measureText(normalizedText).width <=
    maxWidth
  ) {
    return normalizedText;
  }

  let value = normalizedText;

  while (
    value.length > 1 &&
    context.measureText(`${value}…`).width >
      maxWidth
  ) {
    value = value.slice(0, -1);
  }

  return `${value}…`;
}

function getTimelineX(
  date,
  axisStartDate,
  axisEndDate,
  axisStartX,
  axisWidth
) {
  const total =
    axisEndDate.getTime() -
    axisStartDate.getTime();

  const elapsed =
    date.getTime() -
    axisStartDate.getTime();

  const ratio = Math.max(
    0,
    Math.min(1, elapsed / total)
  );

  return axisStartX + axisWidth * ratio;
}

function drawTimelinePeriodText(
  context,
  startText,
  endText,
  barX,
  barY,
  barWidth,
  barHeight
) {
  context.fillStyle = '#ffffff';
  context.textAlign = 'center';
  context.textBaseline = 'middle';

  if (barWidth >= 126) {
    context.font =
      '700 12px Pretendard, Arial, sans-serif';

    context.fillText(
      `${startText} ~ ${endText}`,
      barX + barWidth / 2,
      barY + barHeight / 2
    );

    return;
  }

  context.font =
    '700 9px Pretendard, Arial, sans-serif';

  context.fillText(
    `${startText} ~`,
    barX + barWidth / 2,
    barY + 13
  );

  context.fillText(
    endText,
    barX + barWidth / 2,
    barY + 27
  );
}

function drawTimelineMilestone(
  context,
  segment,
  color,
  x,
  slotY,
  axisEndX
) {
  const diamondSize = 7;
  const labelX = Math.min(
    x + 13,
    axisEndX - 155
  );

  context.save();
  context.translate(x, slotY + 31);
  context.rotate(Math.PI / 4);
  context.fillStyle = color;
  context.fillRect(
    -diamondSize / 2,
    -diamondSize / 2,
    diamondSize,
    diamondSize
  );
  context.restore();

  context.beginPath();
  context.moveTo(x, slotY + 12);
  context.lineTo(x, slotY + 49);
  context.strokeStyle = color;
  context.lineWidth = 2;
  context.stroke();

  context.textAlign = 'left';
  context.textBaseline = 'middle';
  context.fillStyle = '#344054';
  context.font =
    '700 11px Pretendard, Arial, sans-serif';

  context.fillText(
    fitCanvasText(
      context,
      segment.title,
      Math.max(80, axisEndX - labelX)
    ),
    labelX,
    slotY + 24
  );

  context.fillStyle = '#667085';
  context.font =
    '600 10px Pretendard, Arial, sans-serif';

  context.fillText(
    formatTimelineMonth(segment.startDate),
    labelX,
    slotY + 42
  );
}

function drawCareerTimelineCanvas() {
  if (!resumeData?.experience?.length) {
    return;
  }

  const modal = createCareerTimelineModal();
  const canvas = modal.querySelector(
    '#career-timeline-canvas'
  );
  const viewport = modal.querySelector(
    '.career-timeline-modal__viewport'
  );

  if (!canvas || !viewport) {
    return;
  }

  const items = getTimelineItems(
    resumeData.experience
  );

  const today = getLocalToday();
  const devicePixelRatio = Math.min(
    window.devicePixelRatio || 1,
    2
  );

  const canvasWidth = Math.max(
    1160,
    viewport.clientWidth - 2
  );

  const headerHeight = 78;
  const segmentSlotHeight = 68;
  const groupVerticalPadding = 18;
  const minimumGroupHeight = 112;
  const bottomPadding = 28;

  const layouts = [];
  let currentY = headerHeight;

  items.forEach((item) => {
    const segmentCount = Math.max(
      item.segments.length,
      1
    );

    const height = Math.max(
      minimumGroupHeight,
      groupVerticalPadding * 2 +
        segmentCount * segmentSlotHeight
    );

    layouts.push({
      item,
      y: currentY,
      height
    });

    currentY += height;
  });

  const canvasHeight =
    currentY + bottomPadding;

  canvas.style.width = `${canvasWidth}px`;
  canvas.style.height = `${canvasHeight}px`;

  canvas.width = Math.round(
    canvasWidth * devicePixelRatio
  );
  canvas.height = Math.round(
    canvasHeight * devicePixelRatio
  );

  const context = canvas.getContext('2d');

  if (!context) {
    return;
  }

  context.setTransform(
    devicePixelRatio,
    0,
    0,
    devicePixelRatio,
    0,
    0
  );

  context.clearRect(
    0,
    0,
    canvasWidth,
    canvasHeight
  );

  const allSegments = items.flatMap(
    (item) => item.segments
  );

  const startDates = allSegments.map(
    (segment) =>
      parseDate(segment.startDate)
  );

  const endDates = allSegments.map(
    (segment) =>
      segment.endDate
        ? parseDate(segment.endDate)
        : today
  );

  const minimumYear = Math.min(
    ...startDates.map(
      (date) => date.getFullYear()
    )
  );

  const maximumYear = Math.max(
    today.getFullYear(),
    ...endDates.map(
      (date) => date.getFullYear()
    )
  );

  const axisStartDate = new Date(
    minimumYear,
    0,
    1
  );

  const axisEndDate = new Date(
    maximumYear + 1,
    0,
    1
  );

  const cardX = 18;
  const cardWidth = 232;
  const axisStartX = 292;
  const axisEndX = canvasWidth - 38;
  const axisWidth =
    axisEndX - axisStartX;
  const axisY = 43;
  const gridBottom =
    canvasHeight - 24;

  const palette = [
    '#3265df',
    '#7836e8',
    '#07966f',
    '#163f65',
    '#d97706',
    '#b83280'
  ];

  context.fillStyle = '#ffffff';
  context.fillRect(
    0,
    0,
    canvasWidth,
    canvasHeight
  );

  context.fillStyle = '#667085';
  context.font =
    '700 14px Pretendard, Arial, sans-serif';
  context.textAlign = 'left';
  context.textBaseline = 'middle';
  context.fillText(
    '연도',
    cardX,
    21
  );

  for (
    let year = minimumYear;
    year <= maximumYear;
    year += 1
  ) {
    const yearDate = new Date(
      year,
      0,
      1
    );

    const nextYearDate = new Date(
      year + 1,
      0,
      1
    );

    const x = getTimelineX(
      yearDate,
      axisStartDate,
      axisEndDate,
      axisStartX,
      axisWidth
    );

    const nextX = getTimelineX(
      nextYearDate,
      axisStartDate,
      axisEndDate,
      axisStartX,
      axisWidth
    );

    if (
      (year - minimumYear) % 2 === 1
    ) {
      context.fillStyle = '#f8faff';
      context.fillRect(
        x,
        axisY + 1,
        nextX - x,
        gridBottom - axisY - 1
      );
    }

    context.beginPath();
    context.moveTo(x, axisY);
    context.lineTo(x, gridBottom);
    context.strokeStyle = '#e3e8f0';
    context.lineWidth = 1;
    context.stroke();

    context.fillStyle = '#667085';
    context.font =
      '700 13px Pretendard, Arial, sans-serif';
    context.textAlign = 'center';
    context.fillText(
      String(year),
      x,
      21
    );
  }

  context.beginPath();
  context.moveTo(
    axisStartX,
    axisY
  );
  context.lineTo(
    axisEndX + 9,
    axisY
  );
  context.strokeStyle = '#1d2939';
  context.lineWidth = 1.5;
  context.stroke();

  context.beginPath();
  context.moveTo(
    axisEndX + 9,
    axisY
  );
  context.lineTo(
    axisEndX,
    axisY - 5
  );
  context.lineTo(
    axisEndX,
    axisY + 5
  );
  context.closePath();
  context.fillStyle = '#1d2939';
  context.fill();

  layouts.forEach(
    ({ item, y: groupY, height }, companyIndex) => {
      const color =
        palette[
          companyIndex % palette.length
        ];

      const cardY = groupY + 18;
      const cardHeight =
        height - 36;

      context.save();
      context.shadowColor =
        'rgba(16, 24, 40, 0.11)';
      context.shadowBlur = 8;
      context.shadowOffsetY = 3;

      drawCanvasRoundRect(
        context,
        cardX,
        cardY,
        cardWidth,
        cardHeight,
        6
      );

      context.fillStyle = '#ffffff';
      context.fill();
      context.restore();

      drawCanvasRoundRect(
        context,
        cardX,
        cardY,
        cardWidth,
        cardHeight,
        6
      );

      context.strokeStyle = '#dde3ec';
      context.lineWidth = 1;
      context.stroke();

      context.fillStyle = color;
      context.fillRect(
        cardX,
        cardY,
        6,
        cardHeight
      );

      context.textAlign = 'left';
      context.textBaseline = 'middle';
      context.fillStyle = '#344054';
      context.font =
        '700 13px Pretendard, Arial, sans-serif';

      context.fillText(
        fitCanvasText(
          context,
          item.company,
          cardWidth - 34
        ),
        cardX + 18,
        cardY + 25
      );

      const positionCount =
        item.segments.filter(
          (segment) =>
            !segment.isMilestone
        ).length;

      const milestoneCount =
        item.segments.filter(
          (segment) =>
            segment.isMilestone
        ).length;

      const summaryParts = [];

      if (positionCount > 1) {
        summaryParts.push(
          `${positionCount}개 직급 이력`
        );
      } else if (
        item.position
      ) {
        summaryParts.push(
          item.position
        );
      }

      if (item.status) {
        summaryParts.push(
          item.status
        );
      }

      context.fillStyle = '#7b8494';
      context.font =
        '500 10px Pretendard, Arial, sans-serif';

      context.fillText(
        fitCanvasText(
          context,
          summaryParts.join(' · '),
          cardWidth - 34
        ),
        cardX + 18,
        cardY + 48
      );

      if (milestoneCount > 0) {
        context.fillStyle = '#174a9c';
        context.font =
          '700 10px Pretendard, Arial, sans-serif';

        context.fillText(
          `주요 이력 ${milestoneCount}건`,
          cardX + 18,
          cardY + 68
        );
      }

      item.segments.forEach(
        (segment, segmentIndex) => {
          const slotY =
            groupY +
            groupVerticalPadding +
            segmentIndex *
              segmentSlotHeight;

          const startDate = parseDate(
            segment.startDate
          );

          const endDate =
            segment.endDate
              ? parseDate(
                  segment.endDate
                )
              : today;

          const startX = getTimelineX(
            startDate,
            axisStartDate,
            axisEndDate,
            axisStartX,
            axisWidth
          );

          if (segment.isMilestone) {
            drawTimelineMilestone(
              context,
              segment,
              color,
              startX,
              slotY,
              axisEndX
            );

            return;
          }

          const endX = getTimelineX(
            endDate,
            axisStartDate,
            axisEndDate,
            axisStartX,
            axisWidth
          );

          const barX = startX;
          const barWidth = Math.max(
            72,
            endX - startX
          );

          const roleLabel = [
            segment.title,
            segment.type
          ]
            .filter(Boolean)
            .join(' · ');

          context.fillStyle = '#344054';
          context.font =
            '700 10px Pretendard, Arial, sans-serif';
          context.textAlign = 'left';
          context.textBaseline = 'middle';

          context.fillText(
            fitCanvasText(
              context,
              roleLabel,
              Math.max(
                80,
                axisEndX - barX
              )
            ),
            barX,
            slotY + 10
          );

          const barY = slotY + 21;
          const barHeight = 38;

          context.save();
          context.shadowColor =
            'rgba(16, 24, 40, 0.16)';
          context.shadowBlur = 6;
          context.shadowOffsetY = 3;

          drawCanvasRoundRect(
            context,
            barX,
            barY,
            barWidth,
            barHeight,
            8
          );

          context.fillStyle = color;
          context.fill();
          context.restore();

          drawTimelinePeriodText(
            context,
            formatTimelineMonth(
              segment.startDate
            ),
            segment.endDate
              ? formatTimelineMonth(
                  segment.endDate
                )
              : '현재',
            barX,
            barY,
            barWidth,
            barHeight
          );
        }
      );

      context.beginPath();
      context.moveTo(
        cardX,
        groupY + height - 8
      );
      context.lineTo(
        canvasWidth - 24,
        groupY + height - 8
      );
      context.strokeStyle = '#f0f2f5';
      context.lineWidth = 1;
      context.stroke();
    }
  );
}

function createCareerTimelineModal() {
  if (careerTimelineModal) return careerTimelineModal;

  const modal = createElement('div', 'career-timeline-modal');
  modal.hidden = true;
  modal.setAttribute('aria-hidden', 'true');

  const backdrop = createElement('div', 'career-timeline-modal__backdrop');
  backdrop.dataset.timelineModalClose = 'true';

  const dialog = createElement('section', 'career-timeline-modal__dialog');
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('aria-labelledby', 'career-timeline-modal-title');
  dialog.setAttribute('aria-describedby', 'career-timeline-modal-description');
  dialog.tabIndex = -1;

  const header = createElement('header', 'career-timeline-modal__header');
  const heading = createElement('div', 'career-timeline-modal__heading');
  const eyebrow = createElement('p', 'career-timeline-modal__eyebrow', 'CAREER TIMELINE');
  const title = createElement('h2', '', '전체 경력 타임라인');
  title.id = 'career-timeline-modal-title';
  const description = createElement(
    'p',
    '',
    '회사별 재직 기간과 직급·승진 이력, 동시에 진행된 경력을 같은 연도축에서 확인할 수 있습니다.'
  );
  description.id = 'career-timeline-modal-description';
  heading.append(eyebrow, title, description);

  const closeButton = createElement('button', 'career-timeline-modal__close');
  closeButton.type = 'button';
  closeButton.setAttribute('aria-label', '전체 경력 타임라인 팝업 닫기');
  closeButton.innerHTML = '<span aria-hidden="true"></span>';
  closeButton.dataset.timelineModalClose = 'true';
  header.append(heading, closeButton);

  const body = createElement('div', 'career-timeline-modal__body');
  const guide = createElement(
    'p',
    'career-timeline-modal__guide',
    '좌우로 밀어 전체 연도를 확인할 수 있습니다.'
  );
  const viewport = createElement('div', 'career-timeline-modal__viewport');
  const canvas = document.createElement('canvas');
  canvas.id = 'career-timeline-canvas';
  canvas.setAttribute('aria-label', '회사별 전체 경력 기간을 나타낸 연도별 타임라인');
  canvas.textContent = 'Canvas를 지원하는 브라우저에서 경력 타임라인을 확인할 수 있습니다.';
  viewport.append(canvas);
  body.append(guide, viewport);
  dialog.append(header, body);
  modal.append(backdrop, dialog);
  document.body.append(modal);

  modal.addEventListener('click', (event) => {
    if (event.target.closest('[data-timeline-modal-close="true"]')) {
      closeCareerTimelineModal();
    }
  });

  modal.addEventListener('keydown', (event) => {
    if (event.key !== 'Tab') return;

    const focusableElements = [...modal.querySelectorAll(
      'button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'
    )].filter((element) => !element.hidden && element.offsetParent !== null);

    if (focusableElements.length === 0) {
      event.preventDefault();
      dialog.focus();
      return;
    }

    const firstElement = focusableElements[0];
    const lastElement = focusableElements.at(-1);

    if (event.shiftKey && document.activeElement === firstElement) {
      event.preventDefault();
      lastElement.focus();
    } else if (!event.shiftKey && document.activeElement === lastElement) {
      event.preventDefault();
      firstElement.focus();
    }
  });

  careerTimelineModal = modal;
  return modal;
}

function openCareerTimelineModal(triggerElement) {
  if (!resumeData?.experience?.length) return;

  const modal = createCareerTimelineModal();
  if (careerTimelineCloseTimer) {
    clearTimeout(careerTimelineCloseTimer);
    careerTimelineCloseTimer = null;
  }

  timelineLastFocusedElement = triggerElement || document.activeElement;

  if (!history.state?.[TIMELINE_MODAL_HISTORY_KEY]) {
    history.pushState(
      {
        ...(history.state || {}),
        [TIMELINE_MODAL_HISTORY_KEY]: true
      },
      '',
      window.location.href
    );
  }

  modal.hidden = false;
  modal.setAttribute('aria-hidden', 'false');
  document.body.classList.add('modal-open');

  window.requestAnimationFrame(() => {
    modal.classList.add('is-open');
    drawCareerTimelineCanvas();
    modal.querySelector('.career-timeline-modal__close')?.focus();
  });
}

function hideCareerTimelineModal() {
  if (!careerTimelineModal || careerTimelineModal.hidden) return;

  careerTimelineModal.classList.remove('is-open');
  careerTimelineModal.setAttribute('aria-hidden', 'true');
  if (!projectModal || projectModal.hidden) {
    document.body.classList.remove('modal-open');
  }

  careerTimelineCloseTimer = window.setTimeout(() => {
    careerTimelineModal.hidden = true;
    careerTimelineCloseTimer = null;
    timelineLastFocusedElement?.focus();
  }, 180);
}

function closeCareerTimelineModal({ fromHistory = false } = {}) {
  if (!careerTimelineModal || careerTimelineModal.hidden) return;

  if (!fromHistory && history.state?.[TIMELINE_MODAL_HISTORY_KEY]) {
    history.back();
    return;
  }

  hideCareerTimelineModal();
}

function renderExperience(items) {
  const children = items.map((item) => {
    const article = createElement('article', 'record-item company-record');

    const period = createElement(
      'p',
      'record-period',
      formatExperiencePeriod(item)
    );

    const content = createElement('div', 'record-content');

    const companyHeader = createElement('div', 'company-header');
    const companyInfo = createElement('div', 'company-info');
    const companyName = createElement('h3', '', item.company);

    companyInfo.append(companyName);

    if (item.status) {
      companyInfo.append(
        createElement('span', 'status-badge', item.status)
      );
    }

    companyHeader.append(companyInfo);

    if (item.projectDetails) {
      const detailButton = createElement(
        'button',
        'experience-detail-button',
        '자세히보기'
      );

      detailButton.type = 'button';
      detailButton.addEventListener('click', () => {
        openProjectModal(item, detailButton);
      });

      companyHeader.append(detailButton);
    }

    content.append(companyHeader);

    if (Array.isArray(item.positions)) {
      const positionTimeline = createElement(
        'div',
        'position-timeline'
      );

      item.positions.forEach((position) => {
        const positionItem = createElement(
          'div',
          'position-item'
        );

        const positionPeriod = createElement(
          'p',
          'position-period',
          formatExperiencePeriod(position)
        );

        const positionTitle = createElement(
          'p',
          'position-title',
          position.title
        );

        positionItem.append(positionPeriod, positionTitle);

        if (position.type) {
          positionItem.append(
            createElement(
              'span',
              'position-type',
              position.type
            )
          );
        }

        positionTimeline.append(positionItem);
      });

      content.append(positionTimeline);
    } else if (item.position) {
      content.append(
        createElement(
          'p',
          'experience-position',
          item.position
        )
      );
    }

    if (Array.isArray(item.duties) && item.duties.length > 0) {
      const duties = createElement('div', 'experience-duties');
      const dutiesTitle = createElement(
        'p',
        'experience-duties-title',
        '주요 수행 업무'
      );
      const dutiesList = createElement('ul');

      item.duties.forEach((duty) => {
        dutiesList.append(createElement('li', '', duty));
      });

      duties.append(dutiesTitle, dutiesList);
      content.append(duties);
    }

    article.append(period, content);

    return article;
  });

  replaceChildren(
    document.querySelector('#experience-list'),
    children
  );
}

function renderCertifications(items) {
  const children = items.map((item) => {
    const article = createElement('article', 'certificate-item');

    const info = createElement('div', 'certificate-info');
    const name = createElement('h3', '', item.name);

    info.append(name);

    if (item.issuer) {
      info.append(
        createElement(
          'p',
          'certificate-issuer',
          `${item.issuer}`
        )
      );
    }

    const year = createElement(
      'time',
      'certificate-year',
      item.year
    );

    year.dateTime = item.year;

    article.append(info, year);

    return article;
  });

  replaceChildren(
    document.querySelector('#certification-list'),
    children
  );
}

function renderActivities(groups) {
  const children = groups.map((group) => {
    const section = createElement('section', 'activity-year-group');
    const headingId = `activity-${group.year}`;
    section.setAttribute('aria-labelledby', headingId);

    const heading = createElement('h3', '', group.year);
    heading.id = headingId;

    const list = createElement('ul');
    group.items.forEach((item) => {
      const listItem = createElement('li');
      const organization = createElement('strong', '', item.organization);
      const role = createElement('span', '', item.role);
      const period = createElement('time', '', item.period);
      listItem.append(organization, role, period);
      list.append(listItem);
    });

    section.append(heading, list);
    return section;
  });

  replaceChildren(document.querySelector('#activity-list'), children);
}

function renderError(error) {
  console.error('이력 데이터를 불러오지 못했습니다.', error);

  const targets = [
    '#summary-list',
    '#education-list',
    '#experience-list',
    '#certification-list',
    '#activity-list'
  ];

  targets.forEach((selector) => {
    const target = document.querySelector(selector);
    if (!target) return;
    const message = createElement(
      'p',
      'data-error',
      'data.json을 불러오지 못했습니다. 웹 서버에서 실행 중인지 파일 경로를 확인해 주세요.'
    );
    target.replaceChildren(message);
  });
}

function initSectionObserver() {
  if (!('IntersectionObserver' in window)) return;

  const sections = [...document.querySelectorAll('main section[id]')];
  const sectionObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        navLinks.forEach((link) => {
          link.classList.toggle('active', link.getAttribute('href') === `#${entry.target.id}`);
        });
      });
    },
    { rootMargin: '-30% 0px -60% 0px', threshold: 0 }
  );

  sections.forEach((section) => sectionObserver.observe(section));
}

async function loadResumeData() {
  try {
    const response = await fetch(DATA_URL, { cache: 'no-store' });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    resumeData = await response.json();
    renderProfile(resumeData.profile, resumeData.site);
    renderEducation(resumeData.education);
    renderExperience(resumeData.experience);
    renderCertifications(resumeData.certifications);
    renderActivities(resumeData.activities);
    updateCareerDuration();
    scheduleCareerRefresh();
  } catch (error) {
    renderError(error);
  } finally {
    initSectionObserver();
  }
}

document.querySelectorAll('.brand').forEach((brand) => {
  brand.addEventListener('click', (event) => {
    event.preventDefault();

    window.scrollTo({
      top: 0,
      behavior: 'smooth'
    });
  });
});

function calculateFullAge(birthDateValue, today = getLocalToday()) {
  const birthDate = parseDate(birthDateValue);

  let age = today.getFullYear() - birthDate.getFullYear();

  const birthdayHasPassed =
    today.getMonth() > birthDate.getMonth() ||
    (
      today.getMonth() === birthDate.getMonth() &&
      today.getDate() >= birthDate.getDate()
    );

  if (!birthdayHasPassed) {
    age -= 1;
  }

  return age;
}

function formatBirthInfo(birthDateValue) {
  const birthDate = parseDate(birthDateValue);
  const age = calculateFullAge(birthDateValue);

  return `${birthDate.getFullYear()}년 ${
    birthDate.getMonth() + 1
  }월 (만 ${age}세)`;
}

function updateBirthAge() {
  if (!resumeData?.profile?.birthDate) return;

  const birthElement = document.querySelector('[data-summary="birth"]');

  if (birthElement) {
    birthElement.textContent = formatBirthInfo(
      resumeData.profile.birthDate
    );
  }
}

document.querySelector('#career-timeline-button')?.addEventListener(
  'click',
  (event) => openCareerTimelineModal(event.currentTarget)
);

window.addEventListener('popstate', () => {
  if (projectModal && !projectModal.hidden) {
    closeProjectModal({
      fromHistory: true
    });
  }

  if (careerTimelineModal && !careerTimelineModal.hidden) {
    closeCareerTimelineModal({
      fromHistory: true
    });
  }
});

loadResumeData();

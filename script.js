const DATA_URL = './data.json';

const menuButton = document.querySelector('.menu-button');
const primaryNav = document.querySelector('.primary-nav');
const navLinks = [...document.querySelectorAll('.primary-nav a[href^="#"]')];
const yearElement = document.querySelector('#current-year');
const printButton = document.querySelector('#site-print-button');
const initialLocationHash = window.location.hash;

// 개인용 인쇄 버튼은 기본적으로 숨깁니다.
// 개발자도구에서 #site-print-button의 hidden 속성을 제거하면 즉시 표시됩니다.
if (printButton) {
  printButton.hidden = true;
  printButton.setAttribute('hidden', '');

  if (!document.querySelector('#private-print-button-style')) {
    const privatePrintStyle = document.createElement('style');
    privatePrintStyle.id = 'private-print-button-style';
    privatePrintStyle.textContent = '.site-print-button[hidden]{display:none!important;}';
    document.head.appendChild(privatePrintStyle);
  }
}
const printResume = document.querySelector('#print-resume');
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
let timelineHitAreas = [];
let timelineHoveredKey = null;
let timelineHoverProgress = 0;
let timelineHoverAnimationFrame = null;
let timelineTouchResetTimer = null;
let timelinePointerStart = null;

const TIMELINE_MIN_ZOOM = 0.35;
const TIMELINE_MAX_ZOOM = 2.5;
let timelineZoom = 1;
let timelineActivePointers = new Map();
let timelinePinchState = null;
let timelineZoomAnimationFrame = null;
let timelinePendingZoom = null;
let originalDocumentTitle = null;

if (printButton) {
  printButton.disabled = true;
}

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

function getTimelineTypePriority(value) {
  const priorities = {
    'IT병역특례': 1,
    '학업병행': 2,
    '프리랜서': 3,
    '재직중': 4
  };

  return priorities[value] || 99;
}

function isTimelineDisplayType(value) {
  return ['IT병역특례', '학업병행', '프리랜서'].includes(value);
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

    const regularSegments = segments.filter(
      (segment) => !segment.isMilestone
    );

    const latestRegularSegment =
      regularSegments[0] || null;

    const uniqueTypes = [...new Set(
      regularSegments
        .map((segment) => segment.type)
        .filter((type) =>
          isTimelineDisplayType(type)
        )
    )].sort(
      (first, second) =>
        getTimelineTypePriority(first) -
          getTimelineTypePriority(second) ||
        first.localeCompare(second, 'ko')
    );

    const cardSummary = hasPositions
      ? [
          latestRegularSegment?.title ||
            item.position ||
            '',
          ...uniqueTypes,
          item.status || ''
        ]
          .filter(Boolean)
          .join(' · ')
      : [
          item.position || '',
          item.status || ''
        ]
          .filter(Boolean)
          .join(' · ');

    return {
      company: item.company,
      position: item.position || '',
      status: item.status || '',
      startDate: item.startDate,
      endDate: item.endDate,
      cardSummary,
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

function getTimelineHoverEase(progress) {
  return 1 - Math.pow(1 - progress, 3);
}

function animateTimelineHover() {
  if (timelineHoverAnimationFrame) {
    cancelAnimationFrame(timelineHoverAnimationFrame);
  }

  const startedAt = performance.now();
  const duration = 180;

  const step = (now) => {
    timelineHoverProgress = Math.min(
      1,
      (now - startedAt) / duration
    );

    drawCareerTimelineCanvas();

    if (timelineHoverProgress < 1) {
      timelineHoverAnimationFrame = requestAnimationFrame(step);
    } else {
      timelineHoverAnimationFrame = null;
    }
  };

  timelineHoverAnimationFrame = requestAnimationFrame(step);
}

function setTimelineHoveredKey(key) {
  if (timelineHoveredKey === key) return;

  timelineHoveredKey = key;
  timelineHoverProgress = key ? 0 : 1;

  if (!key) {
    if (timelineHoverAnimationFrame) {
      cancelAnimationFrame(timelineHoverAnimationFrame);
      timelineHoverAnimationFrame = null;
    }

    drawCareerTimelineCanvas();
    return;
  }

  animateTimelineHover();
}

function getTimelineCanvasPoint(canvas, event) {
  const bounds = canvas.getBoundingClientRect();
  const logicalWidth = canvas.__logicalWidth || bounds.width;
  const logicalHeight = canvas.__logicalHeight || bounds.height;

  return {
    x: (event.clientX - bounds.left) * (logicalWidth / bounds.width),
    y: (event.clientY - bounds.top) * (logicalHeight / bounds.height)
  };
}

function findTimelineHitArea(canvas, event) {
  const point = getTimelineCanvasPoint(canvas, event);

  return [...timelineHitAreas]
    .reverse()
    .find((area) =>
      point.x >= area.x &&
      point.x <= area.x + area.width &&
      point.y >= area.y &&
      point.y <= area.y + area.height
    );
}

function clampTimelineZoom(value) {
  return Math.min(
    TIMELINE_MAX_ZOOM,
    Math.max(TIMELINE_MIN_ZOOM, value)
  );
}

function getTimelineScrollTargets(canvas) {
  return {
    horizontal: canvas.closest('.career-timeline-modal__viewport'),
    vertical: canvas.closest('.career-timeline-modal__body')
  };
}

function getTimelinePinchPoints() {
  return [...timelineActivePointers.values()].slice(0, 2);
}

function getTimelinePinchMetrics(points) {
  if (points.length < 2) return null;

  const [first, second] = points;

  return {
    distance: Math.max(
      1,
      Math.hypot(
        second.clientX - first.clientX,
        second.clientY - first.clientY
      )
    ),
    clientX: (first.clientX + second.clientX) / 2,
    clientY: (first.clientY + second.clientY) / 2
  };
}

function beginTimelinePinch(canvas) {
  const metrics = getTimelinePinchMetrics(
    getTimelinePinchPoints()
  );

  if (!metrics) return;

  const bounds = canvas.getBoundingClientRect();
  const logicalWidth = canvas.__logicalWidth || bounds.width;
  const logicalHeight = canvas.__logicalHeight || bounds.height;

  timelinePinchState = {
    startDistance: metrics.distance,
    startZoom: timelineZoom,
    anchorX:
      (metrics.clientX - bounds.left) *
      (logicalWidth / bounds.width),
    anchorY:
      (metrics.clientY - bounds.top) *
      (logicalHeight / bounds.height)
  };

  timelinePointerStart = null;
  canvas.classList.remove('is-dragging');
  canvas.classList.add('is-pinching');
  setTimelineHoveredKey(null);

  if (timelineTouchResetTimer) {
    clearTimeout(timelineTouchResetTimer);
    timelineTouchResetTimer = null;
  }
}

function scheduleTimelineZoom(
  canvas,
  zoom,
  clientX,
  clientY,
  anchorX,
  anchorY
) {
  timelinePendingZoom = {
    canvas,
    zoom: clampTimelineZoom(zoom),
    clientX,
    clientY,
    anchorX,
    anchorY
  };

  if (timelineZoomAnimationFrame) return;

  timelineZoomAnimationFrame = window.requestAnimationFrame(() => {
    timelineZoomAnimationFrame = null;

    const pending = timelinePendingZoom;
    timelinePendingZoom = null;

    if (!pending) return;

    const { horizontal, vertical } = getTimelineScrollTargets(
      pending.canvas
    );

    if (!horizontal || !vertical) return;

    const viewportBounds = horizontal.getBoundingClientRect();
    const bodyBounds = vertical.getBoundingClientRect();
    const canvasBounds = pending.canvas.getBoundingClientRect();

    /*
     * 확대 전 손가락 중심 아래에 있던 Canvas 좌표를 기억한 뒤,
     * 확대 후에도 동일한 화면 위치에 남도록 두 스크롤 영역을 보정합니다.
     */
    const canvasContentLeft =
      canvasBounds.left - viewportBounds.left + horizontal.scrollLeft;
    const canvasContentTop =
      canvasBounds.top - bodyBounds.top + vertical.scrollTop;

    timelineZoom = pending.zoom;
    drawCareerTimelineCanvas();

    horizontal.scrollLeft =
      canvasContentLeft +
      pending.anchorX * timelineZoom -
      (pending.clientX - viewportBounds.left);

    vertical.scrollTop =
      canvasContentTop +
      pending.anchorY * timelineZoom -
      (pending.clientY - bodyBounds.top);

    const guide = careerTimelineModal?.querySelector(
      '.career-timeline-modal__guide'
    );

    if (guide) {
      guide.dataset.zoom = `${Math.round(timelineZoom * 100)}%`;
    }
  });
}

function resetTimelineGestureState(canvas) {
  timelineActivePointers.clear();
  timelinePinchState = null;
  timelinePointerStart = null;
  timelinePendingZoom = null;

  if (timelineZoomAnimationFrame) {
    cancelAnimationFrame(timelineZoomAnimationFrame);
    timelineZoomAnimationFrame = null;
  }

  canvas?.classList.remove('is-dragging', 'is-pinching');
}

function bindTimelineCanvasInteractions(canvas) {
  if (canvas.dataset.timelineInteractive === 'true') return;

  canvas.dataset.timelineInteractive = 'true';

  const finishTimelinePointer = (event) => {
    if (
      !timelinePointerStart ||
      timelinePointerStart.pointerId !== event.pointerId
    ) {
      return null;
    }

    const completedPointer = timelinePointerStart;
    timelinePointerStart = null;

    canvas.classList.remove('is-dragging');

    if (canvas.hasPointerCapture?.(event.pointerId)) {
      canvas.releasePointerCapture(event.pointerId);
    }

    canvas.style.cursor = completedPointer.wasDragging
      ? 'grab'
      : canvas.style.cursor;

    return completedPointer;
  };

  const continueWithRemainingTouch = () => {
    const remainingEntry = [...timelineActivePointers.entries()][0];

    if (!remainingEntry) {
      timelinePointerStart = null;
      return;
    }

    const [pointerId, pointer] = remainingEntry;
    const { horizontal, vertical } = getTimelineScrollTargets(canvas);

    if (!horizontal || !vertical) return;

    timelinePointerStart = {
      pointerId,
      pointerType: 'touch',
      clientX: pointer.clientX,
      clientY: pointer.clientY,
      startScrollLeft: horizontal.scrollLeft,
      startScrollTop: vertical.scrollTop,
      canDrag: true,
      /* 핀치 이후 남은 손가락이 탭으로 오인되지 않도록 처리합니다. */
      wasDragging: true
    };
  };

  /*
   * 한 손가락 또는 마우스로는 Canvas를 이동하고,
   * 두 손가락으로는 손가락 중심을 기준으로 확대·축소합니다.
   */
  canvas.addEventListener('pointerdown', (event) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;

    const hitArea = findTimelineHitArea(canvas, event);
    const { horizontal, vertical } = getTimelineScrollTargets(canvas);

    if (!horizontal || !vertical) return;

    if (event.pointerType === 'touch') {
      timelineActivePointers.set(event.pointerId, {
        clientX: event.clientX,
        clientY: event.clientY
      });

      canvas.setPointerCapture?.(event.pointerId);

      if (timelineActivePointers.size === 2) {
        beginTimelinePinch(canvas);
        event.preventDefault();
        return;
      }

      if (timelineActivePointers.size > 2) {
        event.preventDefault();
        return;
      }
    }

    const canDrag = event.pointerType === 'touch' || !hitArea;

    if (!canDrag) return;

    timelinePointerStart = {
      pointerId: event.pointerId,
      pointerType: event.pointerType,
      clientX: event.clientX,
      clientY: event.clientY,
      startScrollLeft: horizontal.scrollLeft,
      startScrollTop: vertical.scrollTop,
      canDrag,
      wasDragging: false
    };

    canvas.setPointerCapture?.(event.pointerId);
  });

  canvas.addEventListener(
    'pointermove',
    (event) => {
      if (
        event.pointerType === 'touch' &&
        timelineActivePointers.has(event.pointerId)
      ) {
        timelineActivePointers.set(event.pointerId, {
          clientX: event.clientX,
          clientY: event.clientY
        });
      }

      if (
        event.pointerType === 'touch' &&
        timelinePinchState &&
        timelineActivePointers.size >= 2
      ) {
        const metrics = getTimelinePinchMetrics(
          getTimelinePinchPoints()
        );

        if (metrics) {
          event.preventDefault();

          scheduleTimelineZoom(
            canvas,
            timelinePinchState.startZoom *
              (metrics.distance / timelinePinchState.startDistance),
            metrics.clientX,
            metrics.clientY,
            timelinePinchState.anchorX,
            timelinePinchState.anchorY
          );
        }

        return;
      }

      if (
        timelinePointerStart &&
        timelinePointerStart.pointerId === event.pointerId
      ) {
        const deltaX = event.clientX - timelinePointerStart.clientX;
        const deltaY = event.clientY - timelinePointerStart.clientY;
        const movement = Math.hypot(deltaX, deltaY);

        if (
          timelinePointerStart.canDrag &&
          !timelinePointerStart.wasDragging &&
          movement > 6
        ) {
          timelinePointerStart.wasDragging = true;
          canvas.classList.add('is-dragging');
          setTimelineHoveredKey(null);
        }

        if (timelinePointerStart.wasDragging) {
          const { horizontal, vertical } = getTimelineScrollTargets(canvas);

          event.preventDefault();

          if (horizontal) {
            horizontal.scrollLeft =
              timelinePointerStart.startScrollLeft - deltaX;
          }

          if (vertical) {
            vertical.scrollTop =
              timelinePointerStart.startScrollTop - deltaY;
          }

          return;
        }
      }

      if (event.pointerType === 'touch') return;

      const hoveredArea = findTimelineHitArea(canvas, event);

      canvas.style.cursor = hoveredArea ? 'pointer' : 'grab';
      setTimelineHoveredKey(hoveredArea?.key || null);
    },
    { passive: false }
  );

  canvas.addEventListener('pointerleave', (event) => {
    if (timelinePointerStart?.wasDragging || timelinePinchState) return;
    if (event.pointerType === 'touch') return;

    canvas.style.cursor = 'grab';
    setTimelineHoveredKey(null);
  });

  canvas.addEventListener('pointerup', (event) => {
    const wasPinching =
      event.pointerType === 'touch' && Boolean(timelinePinchState);

    if (event.pointerType === 'touch') {
      timelineActivePointers.delete(event.pointerId);
    }

    if (wasPinching) {
      if (canvas.hasPointerCapture?.(event.pointerId)) {
        canvas.releasePointerCapture(event.pointerId);
      }

      if (timelineActivePointers.size >= 2) {
        beginTimelinePinch(canvas);
      } else {
        timelinePinchState = null;
        canvas.classList.remove('is-pinching');
        continueWithRemainingTouch();
      }

      return;
    }

    const completedPointer = finishTimelinePointer(event);

    if (!completedPointer) return;

    const movement = Math.hypot(
      event.clientX - completedPointer.clientX,
      event.clientY - completedPointer.clientY
    );

    if (completedPointer.wasDragging || movement > 10) return;
    if (completedPointer.pointerType !== 'touch') return;

    const tappedArea = findTimelineHitArea(canvas, event);

    if (timelineTouchResetTimer) {
      clearTimeout(timelineTouchResetTimer);
      timelineTouchResetTimer = null;
    }

    setTimelineHoveredKey(tappedArea?.key || null);

    if (tappedArea) {
      timelineTouchResetTimer = window.setTimeout(() => {
        setTimelineHoveredKey(null);
        timelineTouchResetTimer = null;
      }, 1100);
    }
  });

  canvas.addEventListener('pointercancel', (event) => {
    if (event.pointerType === 'touch') {
      timelineActivePointers.delete(event.pointerId);
    }

    if (timelinePinchState) {
      if (timelineActivePointers.size >= 2) {
        beginTimelinePinch(canvas);
      } else {
        timelinePinchState = null;
        canvas.classList.remove('is-pinching');
        continueWithRemainingTouch();
      }
    } else {
      finishTimelinePointer(event);
    }
  });

  /* iOS Safari의 비표준 제스처 이벤트가 페이지 확대를 시작하지 않도록 합니다. */
  ['gesturestart', 'gesturechange', 'gestureend'].forEach((eventName) => {
    canvas.addEventListener(
      eventName,
      (event) => event.preventDefault(),
      { passive: false }
    );
  });

  canvas.addEventListener('contextmenu', (event) => {
    event.preventDefault();
  });

  canvas.addEventListener('dragstart', (event) => {
    event.preventDefault();
  });
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

  if (barWidth >= 142) {
    context.font =
      '700 13px Pretendard, Arial, sans-serif';

    context.fillText(
      `${startText} ~ ${endText}`,
      barX + barWidth / 2,
      barY + barHeight / 2
    );

    return;
  }

  context.font =
    '700 11px Pretendard, Arial, sans-serif';

  context.fillText(
    `${startText} ~`,
    barX + barWidth / 2,
    barY + 15
  );

  context.fillText(
    endText,
    barX + barWidth / 2,
    barY + barHeight - 13
  );
}

function drawTimelineMilestone(
  context,
  segment,
  color,
  x,
  slotY,
  axisStartX,
  axisEndX,
  hoverProgress = 0
) {
  const easedHover = getTimelineHoverEase(hoverProgress);
  const lift = 4 * easedHover;
  const diamondSize = 9 + 2 * easedHover;
  const lineTop = slotY + 13 - lift;
  const lineBottom = slotY + 57 - lift;
  const centerY = slotY + 35 - lift;
  const shouldAlignLeft = axisEndX - x >= 190;
  const labelX = shouldAlignLeft
    ? x + 15
    : x - 15;
  const labelWidth = shouldAlignLeft
    ? Math.max(90, axisEndX - labelX)
    : Math.max(90, labelX - axisStartX);

  context.save();
  context.shadowColor = color;
  context.shadowBlur = 13 * easedHover;
  context.translate(x, centerY);
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
  context.moveTo(x, lineTop);
  context.lineTo(x, lineBottom);
  context.strokeStyle = color;
  context.lineWidth = 2 + easedHover;
  context.stroke();

  context.textAlign = shouldAlignLeft ? 'left' : 'right';
  context.textBaseline = 'middle';
  context.fillStyle = hoverProgress > 0 ? color : '#344054';
  context.font =
    '700 13px Pretendard, Arial, sans-serif';

  context.fillText(
    fitCanvasText(
      context,
      segment.title,
      Math.min(220, labelWidth)
    ),
    labelX,
    slotY + 25 - lift
  );

  context.fillStyle = '#667085';
  context.font =
    '600 11px Pretendard, Arial, sans-serif';

  context.fillText(
    formatTimelineMonth(segment.startDate),
    labelX,
    slotY + 45 - lift
  );

  return {
    x: shouldAlignLeft ? x - 10 : Math.max(axisStartX, labelX - 220),
    y: slotY + 7,
    width: shouldAlignLeft
      ? Math.min(axisEndX - x + 10, 250)
      : Math.min(x - axisStartX + 10, 250),
    height: 56
  };
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

  bindTimelineCanvasInteractions(canvas);
  timelineHitAreas = [];

  const items = getTimelineItems(
    resumeData.experience
  );

  const today = getLocalToday();
  const devicePixelRatio = Math.min(
    window.devicePixelRatio || 1,
    2
  );

  const canvasWidth = Math.max(
    1220,
    viewport.clientWidth - 2
  );

  const headerHeight = 84;
  const segmentSlotHeight = 80;
  const groupVerticalPadding = 20;
  const minimumGroupHeight = 124;
  const bottomPadding = 30;

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

  const displayWidth = canvasWidth * timelineZoom;
  const displayHeight = canvasHeight * timelineZoom;

  /*
   * CSS 크기는 zoom 배율만큼 키우고, Canvas 내부 좌표계는 기존 크기를 유지합니다.
   * 따라서 글자·막대·카드가 모두 같은 비율로 확대되며 hit-test 좌표도 안정적입니다.
   */
  canvas.style.width = `${displayWidth}px`;
  canvas.style.height = `${displayHeight}px`;
  canvas.__logicalWidth = canvasWidth;
  canvas.__logicalHeight = canvasHeight;
  canvas.__timelineZoom = timelineZoom;

  /* 과도한 메모리 사용을 막으면서도 확대 시 선명도를 유지합니다. */
  const renderScale = Math.min(
    devicePixelRatio * timelineZoom,
    3
  );

  canvas.width = Math.round(
    canvasWidth * renderScale
  );
  canvas.height = Math.round(
    canvasHeight * renderScale
  );

  const context = canvas.getContext('2d');

  if (!context) {
    return;
  }

  context.setTransform(
    renderScale,
    0,
    0,
    renderScale,
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
  const cardWidth = 242;
  const axisStartX = 310;
  const axisEndX = canvasWidth - 92;
  const axisWidth =
    axisEndX - axisStartX;
  const axisY = 47;
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
    '700 15px Pretendard, Arial, sans-serif';
  context.textAlign = 'left';
  context.textBaseline = 'middle';
  context.fillText(
    '연도',
    cardX,
    23
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
      '700 14px Pretendard, Arial, sans-serif';
    context.textAlign = 'center';
    context.fillText(
      String(year),
      x,
      23
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
        '700 14px Pretendard, Arial, sans-serif';

      context.fillText(
        fitCanvasText(
          context,
          item.company,
          cardWidth - 34
        ),
        cardX + 18,
        cardY + 26
      );

      const summaryText = item.cardSummary || '';

      if (summaryText) {
        context.fillStyle = '#7b8494';
        context.font =
          '500 12px Pretendard, Arial, sans-serif';

        context.fillText(
          fitCanvasText(
            context,
            summaryText,
            cardWidth - 34
          ),
          cardX + 18,
          cardY + 51
        );
      }

      item.segments.forEach(
        (segment, segmentIndex) => {
          const hitKey =
            `${companyIndex}:${segmentIndex}`;
          const isHovered =
            timelineHoveredKey === hitKey;
          const hoverProgress = isHovered
            ? timelineHoverProgress
            : 0;
          const easedHover =
            getTimelineHoverEase(hoverProgress);
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
            const milestoneBounds = drawTimelineMilestone(
              context,
              segment,
              color,
              startX,
              slotY,
              axisStartX,
              axisEndX,
              hoverProgress
            );

            timelineHitAreas.push({
              key: hitKey,
              ...milestoneBounds
            });

            return;
          }

          const endX = getTimelineX(
            endDate,
            axisStartDate,
            axisEndDate,
            axisStartX,
            axisWidth
          );

          const naturalBarWidth =
            endX - startX;
          const minimumBarWidth = 92;
          const barWidth = Math.min(
            Math.max(
              minimumBarWidth,
              naturalBarWidth
            ),
            axisWidth
          );
          const barX = Math.max(
            axisStartX,
            Math.min(
              startX,
              axisEndX - barWidth
            )
          );

          const roleLabel = [
            segment.title,
            isTimelineDisplayType(segment.type)
              ? segment.type
              : ''
          ]
            .filter(Boolean)
            .join(' · ');

          const labelAvailableRight =
            axisEndX - barX;
          const alignLabelRight =
            labelAvailableRight < 210;
          const labelX = alignLabelRight
            ? Math.min(
                axisEndX,
                barX + barWidth
              )
            : barX;
          const labelMaxWidth = alignLabelRight
            ? Math.min(
                240,
                labelX - axisStartX
              )
            : Math.min(
                240,
                axisEndX - labelX
              );
          const lift = 4 * easedHover;

          context.fillStyle = isHovered
            ? color
            : '#344054';
          context.font =
            '700 13px Pretendard, Arial, sans-serif';
          context.textAlign = alignLabelRight
            ? 'right'
            : 'left';
          context.textBaseline = 'middle';

          context.fillText(
            fitCanvasText(
              context,
              roleLabel,
              Math.max(100, labelMaxWidth)
            ),
            labelX,
            slotY + 12 - lift
          );

          const barY = slotY + 27;
          const barHeight = 44;
          const grow = 5 * easedHover;
          const drawX = barX - grow / 2;
          const drawY =
            barY - lift - grow / 2;
          const drawWidth = barWidth + grow;
          const drawHeight = barHeight + grow;

          context.save();
          context.shadowColor = isHovered
            ? color
            : 'rgba(16, 24, 40, 0.16)';
          context.shadowBlur = isHovered
            ? 18 * easedHover
            : 6;
          context.shadowOffsetY = isHovered
            ? 7 * easedHover
            : 3;

          drawCanvasRoundRect(
            context,
            drawX,
            drawY,
            drawWidth,
            drawHeight,
            9
          );

          context.fillStyle = color;
          context.fill();
          context.restore();

          if (isHovered) {
            context.save();
            context.globalAlpha =
              0.18 * easedHover;
            context.strokeStyle = '#ffffff';
            context.lineWidth = 2;
            drawCanvasRoundRect(
              context,
              drawX + 1,
              drawY + 1,
              drawWidth - 2,
              drawHeight - 2,
              8
            );
            context.stroke();
            context.restore();
          }

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
            drawX,
            drawY,
            drawWidth,
            drawHeight
          );

          timelineHitAreas.push({
            key: hitKey,
            x: Math.min(barX, labelX) - 10,
            y: slotY,
            width:
              Math.max(
                barX + barWidth,
                labelX
              ) -
              Math.min(barX, labelX) +
              20,
            height: 76
          });
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
  dialog.tabIndex = -1;

  const header = createElement('header', 'career-timeline-modal__header');
  const heading = createElement('div', 'career-timeline-modal__heading');
  const eyebrow = createElement('p', 'career-timeline-modal__eyebrow', 'CAREER TIMELINE');
  const title = createElement('h2', '', '전체 경력 타임라인');
  title.id = 'career-timeline-modal-title';
  heading.append(eyebrow, title);

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
    '한 손가락으로 이동하고 두 손가락을 벌리거나 오므려 확대·축소할 수 있습니다.'
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

  timelineZoom = 1;
  const timelineCanvas = modal.querySelector('#career-timeline-canvas');
  resetTimelineGestureState(timelineCanvas);

  const guide = modal.querySelector('.career-timeline-modal__guide');
  if (guide) guide.dataset.zoom = '100%';

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

  resetTimelineGestureState(
    careerTimelineModal.querySelector('#career-timeline-canvas')
  );

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
      detailButton.hidden = true;
      detailButton.setAttribute('aria-hidden', 'true');
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

function renderContributions(items = []) {
  const children = items.map((item) => {
    const article = createElement('article', 'contribution-item');
    const category = createElement(
      'strong',
      'contribution-category',
      item.category || '기타'
    );
    const description = createElement(
      'p',
      'contribution-description',
      item.description || ''
    );
    const year = createElement(
      'time',
      'contribution-year',
      item.year || ''
    );

    if (item.year) year.dateTime = item.year;

    article.append(category, description, year);
    return article;
  });

  const target = document.querySelector('#contribution-list');
  if (!target) return;

  if (children.length === 0) {
    target.replaceChildren(
      createElement('p', 'contribution-empty', '등록된 기여사항이 없습니다.')
    );
    return;
  }

  replaceChildren(target, children);
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


function formatPrintDate(dateValue) {
  if (!dateValue) return '';

  const date = parseDate(dateValue);
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0')
  ].join('.');
}

function formatPrintPeriod(item) {
  if (!item?.startDate) return '';

  /*
   * 전역일처럼 시작일과 종료일이 같은 단일 날짜 이력은
   * 월 단위가 아닌 YYYY.MM.DD 형식으로 표시합니다.
   */
  if (
    item.endDate &&
    item.endDate === item.startDate
  ) {
    return formatPrintDate(item.startDate);
  }

  const start = formatTimelineMonth(item.startDate);
  const end = item.endDate
    ? formatTimelineMonth(item.endDate)
    : '현재';

  return `${start} ~ ${end}`;
}

function createPrintTable(headers, rows, className = '') {
  const table = createElement(
    'table',
    `print-table${className ? ` ${className}` : ''}`
  );
  const thead = createElement('thead');
  const headerRow = createElement('tr');

  headers.forEach((header) => {
    const cell = createElement('th', '', header.label);
    if (header.width) cell.style.width = header.width;
    headerRow.append(cell);
  });

  thead.append(headerRow);
  table.append(thead);

  const tbody = createElement('tbody');

  rows.forEach((row) => {
    const tableRow = createElement('tr');

    row.forEach((value) => {
      const cell = createElement('td');

      if (value instanceof Node) {
        cell.append(value);
      } else {
        cell.textContent = value ?? '';
      }

      tableRow.append(cell);
    });

    tbody.append(tableRow);
  });

  table.append(tbody);
  return table;
}

function createPrintSectionHeading(number, title, description = '') {
  const header = createElement('header', 'print-section__heading');
  const numberElement = createElement(
    'span',
    'print-section__number',
    String(number).padStart(2, '0')
  );
  const textArea = createElement('div');
  const heading = createElement('h2', '', title);

  textArea.append(heading);

  if (description) {
    textArea.append(
      createElement('p', '', description)
    );
  }

  header.append(numberElement, textArea);
  return header;
}

function createPrintReferenceHeading(title, description = '') {
  const header = createElement(
    'header',
    'print-section__heading print-section__heading--reference'
  );
  const label = createElement(
    'span',
    'print-section__reference-label',
    '참고자료'
  );
  const textArea = createElement('div');
  const heading = createElement('h2', '', title);

  textArea.append(heading);

  if (description) {
    textArea.append(
      createElement('p', '', description)
    );
  }

  header.append(label, textArea);
  return header;
}

function getPrintDisplayText(value) {
  if (typeof value !== 'string') return value;

  /*
   * 화면과 data.json의 원본 값은 유지하고,
   * 경력기술서 인쇄 결과에서만 기관명을 변경합니다.
   */
  return value.replaceAll('금융권협회', '생명보험협회');
}

function getPrintExperienceItems(data) {
  /*
   * 웹사이트와 data.json의 원본 경력은 그대로 유지하고,
   * 경력기술서 인쇄 결과에서만 '슈어엠' 경력을 제외합니다.
   */
  return (data?.experience || []).filter(
    (item) => item?.company !== '슈어엠'
  );
}


function getPrintPositionText(item) {
  const position = String(item?.position || '');

  /*
   * 나고소프트 경력은 인쇄 결과의 대표 직책에
   * IT병역특례 이력을 함께 표시합니다.
   */
  if (item?.company === '나고소프트') {
    if (position.includes('IT병역특례')) {
      return position;
    }

    if (position.includes('학업병행')) {
      return position.replace(
        '학업병행',
        'IT병역특례 · 학업병행'
      );
    }

    return position
      ? `${position} · IT병역특례`
      : 'IT병역특례';
  }

  return position;
}

function createPrintProfileTable(data) {
  const profile = data.profile || {};
  const table = createElement('table', 'print-profile-table');
  const tbody = createElement('tbody');

  const appendRow = (items) => {
    const row = createElement('tr');

    items.forEach((item) => {
      const label = createElement('th', '', item.label);
      const value = createElement('td', '', item.value || '-');

      row.append(label, value);
    });

    tbody.append(row);
  };

  /*
   * 기본정보에서는 별도 영역과 중복되는 '총 경력'과 '학력'을 제외합니다.
   * 총 경력은 경력 요약에서, 학력은 학력사항 표에서 확인할 수 있습니다.
   */
  appendRow([
    { label: '성명', value: profile.name },
    { label: '현 소속', value: getPrintDisplayText(profile.currentPosition) }
  ]);

  appendRow([
    {
      label: '출생년월',
      value: profile.birthDate
        ? formatBirthInfo(profile.birthDate)
        : ''
    },
    { label: '이메일', value: profile.email }
  ]);

  table.append(tbody);
  return table;
}

function createPrintEducationSection(data) {
  const educationSection = createElement(
    'section',
    'print-compact-block print-full-width-block print-education-block'
  );
  educationSection.append(
    createElement('h3', '', '학력사항')
  );
  educationSection.append(
    createPrintTable(
      [
        { label: '구분', width: '20%' },
        { label: '학교 및 전공' }
      ],
      (data.education || []).map((item) => {
        const detail = createElement('div', 'print-education-inline');
        const school = createElement(
          'strong',
          'print-education-inline__school',
          item.school
        );
        const additionalInfo = [item.major, item.note]
          .filter(Boolean)
          .join(' · ');

        detail.append(school);

        if (additionalInfo) {
          detail.append(
            createElement(
              'span',
              'print-education-inline__meta',
              ` · ${additionalInfo}`
            )
          );
        }

        return [item.period, detail];
      }),
      'print-table--compact print-table--education'
    )
  );

  return educationSection;
}

function createPrintCertificationSection(data) {
  const certificationSection = createElement(
    'section',
    'print-compact-block print-full-width-block print-certification-block'
  );
  certificationSection.append(
    createElement('h3', '', '자격사항')
  );
  certificationSection.append(
    createPrintTable(
      [
        { label: '연도', width: '20%' },
        { label: '자격 및 발급기관' }
      ],
      (data.certifications || []).map((item) => {
        const detail = createElement('div', 'print-certification-inline');
        detail.append(
          createElement(
            'strong',
            'print-certification-inline__name',
            item.name
          )
        );

        if (item.issuer) {
          detail.append(
            createElement(
              'span',
              'print-certification-inline__issuer',
              ` · ${item.issuer}`
            )
          );
        }

        return [item.year, detail];
      }),
      'print-table--compact print-table--certifications'
    )
  );

  return certificationSection;
}


function createPrintSvgElement(tagName, attributes = {}, text = '') {
  const element = document.createElementNS(
    'http://www.w3.org/2000/svg',
    tagName
  );

  Object.entries(attributes).forEach(([name, value]) => {
    element.setAttribute(name, String(value));
  });

  if (text !== undefined && text !== null && text !== '') {
    element.textContent = text;
  }

  return element;
}

function createPrintTimeline(data) {
  const experienceItems = getPrintExperienceItems(data);
  const items = getTimelineItems(experienceItems);

  if (items.length === 0) return null;

  const today = getLocalToday();
  const allSegments = items.flatMap((item) => item.segments);

  if (allSegments.length === 0) return null;

  const startDates = allSegments.map((segment) =>
    parseDate(segment.startDate)
  );
  const endDates = allSegments.map((segment) =>
    segment.endDate ? parseDate(segment.endDate) : today
  );

  const minimumYear = Math.min(
    ...startDates.map((date) => date.getFullYear())
  );
  const maximumYear = Math.max(
    today.getFullYear(),
    ...endDates.map((date) => date.getFullYear())
  );

  const axisStartDate = new Date(minimumYear, 0, 1);
  const axisEndDate = new Date(maximumYear + 1, 0, 1);

  // 인쇄 타임라인은 A4 가로 페이지 전체를 활용합니다.
  const svgWidth = 1500;
  const labelX = 18;
  const labelWidth = 292;
  const axisStartX = 348;
  const axisEndX = svgWidth - 34;
  const axisWidth = axisEndX - axisStartX;
  const headerHeight = 76;
  const segmentHeight = 68;
  const groupPadding = 20;
  const groupGap = 12;
  const minimumGroupHeight = 122;
  const bottomPadding = 24;

  const layouts = [];
  let currentY = headerHeight;

  items.forEach((item) => {
    const segmentCount = Math.max(item.segments.length, 1);
    const height = Math.max(
      minimumGroupHeight,
      groupPadding * 2 + segmentCount * segmentHeight
    );

    layouts.push({ item, y: currentY, height });
    currentY += height + groupGap;
  });

  const svgHeight = currentY + bottomPadding - groupGap;
  const palette = [
    '#3265df',
    '#7836e8',
    '#07966f',
    '#163f65',
    '#d97706',
    '#b83280'
  ];

  const wrapper = createElement('div', 'print-timeline');
  const svg = createPrintSvgElement('svg', {
    viewBox: `0 0 ${svgWidth} ${svgHeight}`,
    role: 'img',
    'aria-label': '회사별 재직 기간과 직급 이력을 표시한 경력 타임라인',
    preserveAspectRatio: 'xMidYMid meet'
  });

  svg.append(
    createPrintSvgElement('rect', {
      x: 0,
      y: 0,
      width: svgWidth,
      height: svgHeight,
      fill: '#ffffff'
    })
  );

  const getX = (date) =>
    getTimelineX(
      date,
      axisStartDate,
      axisEndDate,
      axisStartX,
      axisWidth
    );

  for (let year = minimumYear; year <= maximumYear; year += 1) {
    const yearDate = new Date(year, 0, 1);
    const nextYearDate = new Date(year + 1, 0, 1);
    const x = getX(yearDate);
    const nextX = getX(nextYearDate);

    if ((year - minimumYear) % 2 === 1) {
      svg.append(
        createPrintSvgElement('rect', {
          x,
          y: 56,
          width: Math.max(0, nextX - x),
          height: svgHeight - 72,
          fill: '#f7f9fd'
        })
      );
    }

    svg.append(
      createPrintSvgElement('line', {
        x1: x,
        y1: 56,
        x2: x,
        y2: svgHeight - 18,
        stroke: '#dfe5ee',
        'stroke-width': 1
      }),
      createPrintSvgElement(
        'text',
        {
          x,
          y: 32,
          fill: '#5d687b',
          'font-size': 17,
          'font-weight': 700,
          'text-anchor': 'middle',
          'font-family': 'Pretendard, Noto Sans KR, Arial, sans-serif'
        },
        String(year)
      )
    );
  }

  svg.append(
    createPrintSvgElement('line', {
      x1: axisStartX,
      y1: 56,
      x2: axisEndX,
      y2: 56,
      stroke: '#27364f',
      'stroke-width': 2
    }),
    createPrintSvgElement(
      'text',
      {
        x: labelX,
        y: 32,
        fill: '#5d687b',
        'font-size': 17,
        'font-weight': 700,
        'font-family': 'Pretendard, Noto Sans KR, Arial, sans-serif'
      },
      '회사·직급'
    )
  );

  layouts.forEach(({ item, y: groupY, height }, companyIndex) => {
    const color = palette[companyIndex % palette.length];
    const cardY = groupY + 10;
    const cardHeight = height - 20;

    svg.append(
      createPrintSvgElement('rect', {
        x: labelX,
        y: cardY,
        width: labelWidth,
        height: cardHeight,
        rx: 5,
        fill: '#ffffff',
        stroke: '#d7deea',
        'stroke-width': 1
      }),
      createPrintSvgElement('rect', {
        x: labelX,
        y: cardY,
        width: 6,
        height: cardHeight,
        fill: color
      }),
      createPrintSvgElement(
        'text',
        {
          x: labelX + 18,
          y: cardY + 36,
          fill: '#26354c',
          'font-size': 18,
          'font-weight': 800,
          'font-family': 'Pretendard, Noto Sans KR, Arial, sans-serif'
        },
        getPrintDisplayText(item.company)
      )
    );

    if (item.cardSummary) {
      svg.append(
        createPrintSvgElement(
          'text',
          {
            x: labelX + 18,
            y: cardY + 64,
            fill: '#6b7688',
            'font-size': 15,
            'font-weight': 500,
            'font-family': 'Pretendard, Noto Sans KR, Arial, sans-serif'
          },
          item.cardSummary
        )
      );
    }

    item.segments.forEach((segment, segmentIndex) => {
      const slotY = groupY + groupPadding + segmentIndex * segmentHeight;
      const startDate = parseDate(segment.startDate);
      const endDate = segment.endDate
        ? parseDate(segment.endDate)
        : today;
      const startX = getX(startDate);
      const roleLabel = [
        segment.title,
        isTimelineDisplayType(segment.type) ? segment.type : ''
      ]
        .filter(Boolean)
        .join(' · ');

      if (segment.isMilestone) {
        const centerY = slotY + 35;
        const labelOnRight = axisEndX - startX >= 210;
        const textX = labelOnRight ? startX + 17 : startX - 17;
        const anchor = labelOnRight ? 'start' : 'end';

        svg.append(
          createPrintSvgElement('line', {
            x1: startX,
            y1: centerY - 21,
            x2: startX,
            y2: centerY + 21,
            stroke: color,
            'stroke-width': 2
          }),
          createPrintSvgElement('rect', {
            x: startX - 6,
            y: centerY - 6,
            width: 12,
            height: 12,
            fill: color,
            transform: `rotate(45 ${startX} ${centerY})`
          }),
          createPrintSvgElement(
            'text',
            {
              x: textX,
              y: centerY - 5,
              fill: '#26354c',
              'font-size': 15,
              'font-weight': 700,
              'text-anchor': anchor,
              'font-family': 'Pretendard, Noto Sans KR, Arial, sans-serif'
            },
            roleLabel
          ),
          createPrintSvgElement(
            'text',
            {
              x: textX,
              y: centerY + 17,
              fill: '#6b7688',
              'font-size': 13,
              'font-weight': 600,
              'text-anchor': anchor,
              'font-family': 'Pretendard, Noto Sans KR, Arial, sans-serif'
            },
            formatTimelineMonth(segment.startDate)
          )
        );

        return;
      }

      const endX = getX(endDate);
      const naturalWidth = endX - startX;
      const minimumWidth = 112;
      const barWidth = Math.min(
        Math.max(minimumWidth, naturalWidth),
        axisWidth
      );
      const barX = Math.max(
        axisStartX,
        Math.min(startX, axisEndX - barWidth)
      );
      const barY = slotY + 27;
      const barHeight = 34;
      const labelOnRight = axisEndX - barX < 235;
      const labelX = labelOnRight ? barX + barWidth : barX;
      const labelAnchor = labelOnRight ? 'end' : 'start';
      const periodText = `${formatTimelineMonth(segment.startDate)} ~ ${
        segment.endDate ? formatTimelineMonth(segment.endDate) : '현재'
      }`;

      svg.append(
        createPrintSvgElement(
          'text',
          {
            x: labelX,
            y: slotY + 17,
            fill: '#26354c',
            'font-size': 15,
            'font-weight': 700,
            'text-anchor': labelAnchor,
            'font-family': 'Pretendard, Noto Sans KR, Arial, sans-serif'
          },
          roleLabel
        ),
        createPrintSvgElement('rect', {
          x: barX,
          y: barY,
          width: barWidth,
          height: barHeight,
          rx: 5,
          fill: color
        }),
        createPrintSvgElement(
          'text',
          {
            x: barX + barWidth / 2,
            y: barY + 22,
            fill: '#ffffff',
            'font-size': barWidth < 140 ? 12 : 14,
            'font-weight': 800,
            'text-anchor': 'middle',
            'font-family': 'Pretendard, Noto Sans KR, Arial, sans-serif'
          },
          periodText
        )
      );
    });

    svg.append(
      createPrintSvgElement('line', {
        x1: labelX,
        y1: groupY + height + 3,
        x2: axisEndX,
        y2: groupY + height + 3,
        stroke: '#edf0f5',
        'stroke-width': 1
      })
    );
  });

  wrapper.append(svg);
  return wrapper;
}

function createPrintCareerSummary(data) {
  const rows = getPrintExperienceItems(data).map((item) => {
    const position = createElement(
      'strong',
      '',
      getPrintPositionText(item)
    );

    return [
      formatPrintPeriod(item),
      getPrintDisplayText(item.company),
      position
    ];
  });

  return createPrintTable(
    [
      { label: '재직기간', width: '20%' },
      { label: '회사명', width: '20%' },
      { label: '직급' }
    ],
    rows,
    'print-table--career-summary'
  );
}

function createPrintPositions(item) {
  if (!Array.isArray(item.positions) || item.positions.length === 0) {
    return null;
  }

  const rows = item.positions.map((position) => [
    formatPrintPeriod(position),
    position.title || '',
    position.type || ''
  ]);

  const table = createPrintTable(
    [
      { label: '기간', width: '18%' },
      { label: '직급·직책', width: '45%' },
      { label: '근무 형태 및 비고' }
    ],
    rows,
    'print-table--positions'
  );

  // 인쇄용 직급·직책 이력의 기간 열은 CSS 우선순위와 관계없이 가운데 정렬한다.
  table.querySelectorAll('tr > :first-child').forEach((cell) => {
    cell.style.setProperty('text-align', 'center', 'important');
    cell.style.setProperty('vertical-align', 'middle', 'important');
    cell.style.setProperty('white-space', 'nowrap');
  });

  return table;
}

function createPrintPolicyImprovements(item) {
  const items = Array.isArray(item.policyImprovements)
    ? item.policyImprovements
    : [];

  const rows = items
    .filter((entry) => entry && (entry.period || entry.title || entry.content))
    .map((entry) => {
      const content = createElement(
        'div',
        'print-detail-content print-policy-improvement-content'
      );

      if (entry.title) {
        content.append(
          createElement('span', 'print-detail-title', entry.title)
        );
      }

      if (entry.content) {
        content.append(
          createElement('p', '', entry.content)
        );
      }

      return [
        entry.period || '',
        content
      ];
    });

  if (rows.length === 0) return null;

  return createPrintTable(
    [
      { label: '기간', width: '18%' },
      { label: '수행 내용' }
    ],
    rows,
    'print-table--policy-improvements'
  );
}

function formatPrintProjectYearPeriod(period) {
  const source = String(period || '').trim();
  if (!source) return '';

  const years = source.match(/(?:19|20)\d{2}/g) || [];
  if (years.length === 0) return source;

  const startYear = years[0];
  const endYear = years[years.length - 1];
  const isOpenEnded = /[~～]\s*$/.test(source);

  if (isOpenEnded) return `${startYear} ~`;
  if (startYear === endYear) return startYear;
  return `${startYear} ~ ${endYear}`;
}

function createPrintDetailTable(group) {
  const isProjects = group.key === 'projects';
  const isProgramOperations = group.key === 'programOperations';

  const rows = group.items.map((detail) => {
    const content = createElement('div', 'print-detail-content');
    content.append(
      createElement('span', 'print-detail-title', detail.title || '상세 내역')
    );

    if (detail.summary) {
      content.append(
        createElement('p', '', detail.summary)
      );
    }

    if (Array.isArray(detail.tasks) && detail.tasks.length > 0) {
      const list = createElement('ul', 'print-inline-list');
      detail.tasks.forEach((task) => {
        list.append(createElement('li', '', task));
      });
      content.append(list);
    }

    if (isProjects) {
      return [
        formatPrintProjectYearPeriod(detail.period),
        content
      ];
    }

    if (isProgramOperations) {
      return [
        detail.period || '',
        content
      ];
    }

    return [
      detail.period || '',
      detail.role || detail.client || '',
      content
    ];
  });

  if (isProjects) {
    return createPrintTable(
      [
        { label: '기간', width: '18%' },
        { label: '수행 내용' }
      ],
      rows,
      'print-table--details print-table--projects'
    );
  }

  if (isProgramOperations) {
    return createPrintTable(
      [
        { label: '기간', width: '20%' },
        { label: '수행 내용' }
      ],
      rows,
      'print-table--details print-table--program-operations'
    );
  }

  return createPrintTable(
    [
      { label: '기간', width: '20%' },
      { label: '역할·구분', width: '27%' },
      { label: '수행 내용' }
    ],
    rows,
    'print-table--details'
  );
}

function createPrintCompanySection(item, index) {
  const section = createElement(
    'section',
    'print-company'
  );

  const heading = createElement(
    'header',
    'print-company__heading'
  );
  const titleArea = createElement('div');
  titleArea.append(
    createElement(
      'span',
      'print-company__number',
      String(index + 1).padStart(2, '0')
    ),
    createElement('h2', '', getPrintDisplayText(item.company)),
    createElement('p', '', getPrintPositionText(item))
  );
  heading.append(
    titleArea,
    createElement(
      'strong',
      'print-company__period',
      formatPrintPeriod(item)
    )
  );
  section.append(heading);

  const positionTable = createPrintPositions(item);
  if (positionTable) {
    const positionBlock = createElement(
      'div',
      'print-company__subsection'
    );
    positionBlock.append(
      createElement('h3', '', '직급·직책 이력'),
      positionTable
    );
    section.append(positionBlock);
  }

  if (Array.isArray(item.duties) && item.duties.length > 0) {
    const dutiesBlock = createElement(
      'div',
      'print-company__subsection print-company__duties'
    );
    dutiesBlock.append(
      createElement('h3', '', '주요 수행 업무')
    );
    const list = createElement('ul');
    item.duties.forEach((duty) => {
      list.append(createElement('li', '', duty));
    });
    dutiesBlock.append(list);
    section.append(dutiesBlock);
  }

  const policyImprovementTable = createPrintPolicyImprovements(item);
  if (policyImprovementTable) {
    const policyImprovementBlock = createElement(
      'div',
      'print-company__subsection print-company__policy-improvements'
    );
    policyImprovementBlock.append(
      createElement('h3', '', '제도·가이드·규정 개선 주요 참여'),
      policyImprovementTable
    );
    section.append(policyImprovementBlock);
  }

  normalizeCareerDetailGroups(item)
    // 인쇄본에는 수행 프로젝트만 표시하고, 프로그램 운영 및
    // 솔루션 운영·관리 경험 섹션은 제외합니다.
    .filter((group) => group.key === 'projects' && group.items.length > 0)
    .forEach((group, groupIndex) => {
      const detailBlock = createElement(
        'div',
        'print-company__subsection print-company__detail-group'
      );
      const headingRow = createElement(
        'div',
        'print-company__subheading'
      );
      headingRow.append(
        createElement('h3', '', group.label)
      );
      detailBlock.append(
        headingRow,
        createPrintDetailTable(group)
      );

      if (groupIndex > 0) {
        detailBlock.classList.add('print-company__detail-group--continued');
      }

      section.append(detailBlock);
    });

  return section;
}

function createPrintContributions(data) {
  const items = Array.isArray(data.contributions)
    ? data.contributions
    : [];

  if (items.length === 0) return null;

  /*
   * 기타사항은 좌우 분할 없이 페이지 전체 너비를 사용하는 단일 표로
   * 출력합니다. 항목이 첫 페이지를 넘으면 다음 페이지로 자연스럽게
   * 이어지고, 표 머리글은 새 페이지에서도 반복됩니다.
   */
  const rows = items.map((item) => [
    item.year || '',
    item.category || '기타',
    item.description || ''
  ]);

  return createPrintTable(
    [
      { label: '연도', width: '20%' },
      { label: '구분', width: '20%' },
      { label: '기타 내용' }
    ],
    rows,
    'print-table--contribution-compact'
  );
}

function createPrintActivities(data) {
  const rows = [];

  (data.activities || []).forEach((group) => {
    (group.items || [])
      .filter((item) => item.includeInPrint === true)
      .forEach((item) => {
        rows.push([
          item.period || group.year,
          item.organization || '',
          item.role || ''
        ]);
      });
  });

  if (rows.length === 0) return null;

  return createPrintTable(
    [
      { label: '기간', width: '20%' },
      { label: '기관 및 활동', width: '62%' },
      { label: '역할', width: '18%' }
    ],
    rows,
    'print-table--activities'
  );
}

function renderPrintResume() {
  if (!printResume || !resumeData) return;

  const header = createElement('header', 'print-resume__header');
  const titleArea = createElement('div', 'print-resume__title-area');
  titleArea.append(
    createElement('h1', '', '경력기술서')
  );
  header.append(titleArea);

  const overview = createElement(
    'section',
    'print-section print-section--overview'
  );

  const careerBlock = createElement(
    'div',
    'print-compact-block print-full-width-block print-career-block'
  );
  careerBlock.append(
    createElement('h3', 'print-block-title', '경력사항'),
    createPrintCareerSummary(resumeData)
  );

  overview.append(
    createPrintProfileTable(resumeData),
    createPrintEducationSection(resumeData),
    careerBlock,
    createPrintCertificationSection(resumeData)
  );

  /*
   * 기타사항은 학력·경력·자격사항 바로 아래에서 시작합니다.
   * 첫 페이지에 들어가는 만큼 출력하고, 남은 행은 표 머리글과 함께
   * 다음 페이지로 자연스럽게 이어집니다.
   */
  const contributionTable = createPrintContributions(resumeData);
  if (contributionTable) {
    const contributionBlock = createElement(
      'div',
      'print-compact-block print-contribution-block'
    );
    contributionBlock.append(
      createElement('h3', '', '수상내역 등'),
      contributionTable
    );
    overview.append(contributionBlock);
  }

  /*
   * 대외활동은 수상내역 등 표 바로 다음에 이어서 출력합니다.
   * 수상내역이 2페이지로 넘어가면 대외활동도 같은 흐름으로 그 아래에
   * 배치되며, 별도의 강제 페이지 분리는 적용하지 않습니다.
   */
  const activityTable = createPrintActivities(resumeData);
  if (activityTable) {
    const activityBlock = createElement(
      'div',
      'print-compact-block print-activity-block'
    );
    activityBlock.append(
      createElement('h3', '', '대외활동'),
      activityTable
    );
    overview.append(activityBlock);
  }

  const companyDetails = createElement(
    'div',
    'print-company-list'
  );
  getPrintExperienceItems(resumeData).forEach((item, index) => {
    companyDetails.append(
      createPrintCompanySection(item, index)
    );
  });

  /*
   * 경력 타임라인은 본문 뒤에 배치하는 별도 참고자료입니다.
   * 인쇄 결과에서 마지막 A4 가로 페이지로 출력되며,
   * getPrintExperienceItems()를 사용하므로 슈어엠 경력은 제외됩니다.
   */
  const timelineSection = createElement(
    'section',
    'print-section print-section--timeline print-section--reference'
  );
  timelineSection.append(
    createPrintReferenceHeading('경력 타임라인')
  );
  const printTimeline = createPrintTimeline(resumeData);
  if (printTimeline) {
    timelineSection.append(printTimeline);
  }

  const printSections = [
    header,
    overview,
    companyDetails
  ];

  printSections.push(timelineSection);
  printResume.replaceChildren(...printSections);
}

function printTechnicalResume() {
  if (!resumeData) return;

  closeMenu();
  renderPrintResume();

  originalDocumentTitle = document.title;
  document.title = `${resumeData.profile?.name || 'BAELAB'}_경력기술서`;

  window.requestAnimationFrame(() => {
    window.setTimeout(() => {
      window.print();
    }, 50);
  });
}

function renderError(error) {
  console.error('이력 데이터를 불러오지 못했습니다.', error);

  const targets = [
    '#summary-list',
    '#education-list',
    '#experience-list',
    '#certification-list',
    '#contribution-list',
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

function waitForWindowLoad() {
  if (document.readyState === 'complete') {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    window.addEventListener('load', resolve, { once: true });
  });
}

function waitForNextLayout() {
  return new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  });
}

async function restoreInitialHashPosition() {
  // Dynamic resume content changes section offsets after the browser's native
  // fragment navigation, so restore the original target once layout is stable.
  if (!initialLocationHash || window.location.hash !== initialLocationHash) {
    return;
  }

  let targetId;

  try {
    targetId = decodeURIComponent(initialLocationHash.slice(1));
  } catch {
    return;
  }

  const target = document.getElementById(targetId);
  if (!target) return;

  await waitForWindowLoad();

  if (document.fonts?.ready) {
    await document.fonts.ready;
  }

  await waitForNextLayout();

  if (window.location.hash !== initialLocationHash) return;

  target.scrollIntoView({
    behavior: 'instant',
    block: 'start'
  });
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
    renderContributions(resumeData.contributions);
    renderActivities(resumeData.activities);
    renderPrintResume();
    if (printButton) printButton.disabled = false;
    updateCareerDuration();
    scheduleCareerRefresh();
    await restoreInitialHashPosition();
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

printButton?.addEventListener('click', printTechnicalResume);

window.addEventListener('beforeprint', () => {
  renderPrintResume();
});

window.addEventListener('afterprint', () => {
  if (originalDocumentTitle !== null) {
    document.title = originalDocumentTitle;
    originalDocumentTitle = null;
  }
});

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

const DATA_URL = './data.json';

const menuButton = document.querySelector('.menu-button');
const primaryNav = document.querySelector('.primary-nav');
const navLinks = [...document.querySelectorAll('.primary-nav a[href^="#"]')];
const yearElement = document.querySelector('#current-year');

let resumeData = null;
let careerRefreshTimer = null;

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
  if (event.key === 'Escape') closeMenu();
});

window.addEventListener('resize', () => {
  if (window.innerWidth > 720) closeMenu();
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
  return end ? `${start} ~ ${end}` : `${start} ~`;
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
    { label: '현재', value: profile.currentPosition },
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

function renderExperience(items) {
  const children = items.map((item) => {
    const article = createElement('article', 'record-item');

    const period = createElement(
      'p',
      'record-period',
      formatExperiencePeriod(item)
    );

    const content = createElement('div', 'record-content');

    // 회사명과 재직 상태
    const companyRow = createElement('div', 'company-row');
    const companyName = createElement('h3', '', item.company);

    companyRow.append(companyName);

    if (item.status) {
      companyRow.append(
        createElement('span', 'status-badge', item.status)
      );
    }

    // 직책
    const position = createElement(
      'p',
      'experience-position',
      item.position
    );

    content.append(companyRow, position);

    // 수행 업무
    if (Array.isArray(item.duties) && item.duties.length > 0) {
      const duties = createElement('div', 'experience-duties');

      const dutiesTitle = createElement(
        'p',
        'experience-duties-title',
        '주요 수행 업무'
      );

      const dutiesList = createElement('ul');

      item.duties.forEach((duty) => {
        dutiesList.append(
          createElement('li', '', duty)
        );
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
    const article = createElement('article');
    article.append(
      createElement('span', '', item.year),
      createElement('h3', '', item.name)
    );
    return article;
  });

  replaceChildren(document.querySelector('#certification-list'), children);
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

const topButton = document.querySelector('.brand');
topButton.addEventListener('click', () => {
  window.scrollTo({
    top: 0,
    behavior: 'smooth'
  });
});

loadResumeData();

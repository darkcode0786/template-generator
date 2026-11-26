import { describe, expect, it } from "vitest";
import { alignEditorDetailFields, visibleItemKeys } from "@/lib/themeforge/editorDetailFields";

const headerCode = `export const Header = ({ data }: { data?: any }) => (
  <nav>
    {data.navLinks.map((link, index) => (
      <a key={link.label} href={link.url}>
        {link.label}
        {link.dropdown && <i />}
        {link.dropdown && link.dropdownItems && (
          <ul>
            {link.dropdownItems.map((drop) => (
              <a key={drop.label} href={drop.url}>{drop.label}</a>
            ))}
          </ul>
        )}
      </a>
    ))}
  </nav>
);`;

describe("visibleItemKeys", () => {
  it("matches the popup filters that drop extra child keys", () => {
    expect(visibleItemKeys("Process", "steps")).toEqual(new Set(["icon", "title", "desc", "image"]));
    expect(visibleItemKeys("FAQ", "faqItems")).toEqual(new Set(["question", "answer"]));
    expect(visibleItemKeys("About", "features")).toBeNull();
  });
});

describe("alignEditorDetailFields", () => {
  it("turns header navLinks into the content popup shape (label, url, subLinks)", () => {
    const content = {
      image: "/logo.png",
      navLinks: [
        { label: "Home", url: "/" },
        {
          label: "About",
          url: "#",
          dropdown: true,
          dropdownItems: [{ label: "Team", url: "/team" }],
        },
      ],
    };
    const fields = ["image", "navLinks"];
    const r = alignEditorDetailFields(headerCode, content, fields, "Header");
    expect(r.editorFields).toEqual(["image", "menu"]);
    expect(r.content.navLinks).toBeUndefined();
    expect(r.content.menu).toEqual([
      { id: "item-1", label: "Home", url: "/" },
      {
        id: "item-2",
        label: "About",
        url: "#",
        subLinks: [{ id: "item-1", label: "Team", url: "/team" }],
      },
    ]);
    expect(r.code).toContain("data.menu.map((link, index) =>");
    expect(r.code).toContain("href={link.url}");
    expect(r.code).toContain("link.subLinks?.length && <i />");
    expect(r.code).toContain("link.subLinks.map((drop) =>");
    expect(r.code).toContain("href={drop.url}");
    expect(r.code).not.toContain("navLinks");
    expect(r.code).not.toContain("dropdownItems");
    expect(r.code).not.toContain("link.href");
  });

  it("keeps navLinksLeft and rewrites its items to label, url, subLinks", () => {
    const r = alignEditorDetailFields(
      "export const H = ({ data }: { data?: any }) => data.navLinksLeft.map((item) => item.href);",
      { navLinksLeft: [{ label: "Home", href: "/", children: [{ label: "Team", href: "/team" }] }] },
      ["navLinksLeft"],
      "Header",
    );
    expect(r.content.navLinksLeft).toEqual([{ id: "item-1", label: "Home", url: "/", subLinks: [{ id: "item-1", label: "Team", url: "/team" }] }]);
    expect(r.editorFields).toEqual(["navLinksLeft"]);
    expect(r.code).toContain("item.url");
    expect(r.code).not.toContain("data.menu");
  });

  it("rewrites an existing menu's href to url", () => {
    const r = alignEditorDetailFields(
      "export const H = ({ data }: { data?: any }) => <b>{data.menu.map((item) => item.href)}</b>;",
      { menu: [{ label: "Home", href: "/" }] },
      ["menu"],
      "Header",
    );
    expect(r.content.menu).toEqual([{ id: "item-1", label: "Home", url: "/" }]);
    expect(r.code).toContain("item.url");
    expect(r.code).not.toContain("item.href");
  });

  it("renames Process step description to desc and leaves the section description", () => {
    const code = `export const P = ({ data }: { data?: any }) => (
      <section>
        <p>{data.description}</p>
        {data.steps.map((step) => <p key={step.id}>{step.title} {step.description}</p>)}
      </section>
    );`;
    const r = alignEditorDetailFields(
      code,
      {
        description: "How we work",
        steps: [{ id: "1", icon: "FaUsers", title: "Call", description: "We listen." }],
      },
      ["description", "steps"],
      "Process",
    );
    expect(r.content.description).toBe("How we work");
    expect(r.content.steps).toEqual([{ id: "1", icon: "FaUsers", title: "Call", desc: "We listen." }]);
    expect(r.code).toContain("{data.description}");
    expect(r.code).toContain("step.desc");
    expect(r.code).not.toContain("step.description");
  });

  it("maps faqItems title/description onto question/answer and skips card-shaped items", () => {
    const code = `export const F = ({ data }: { data?: any }) => data.faqItems.map((faq) => <p>{faq.title} {faq.description}</p>);`;
    const r = alignEditorDetailFields(
      code,
      { faqItems: [{ title: "Hours?", description: "Nine to five." }] },
      ["faqItems"],
      "FAQ",
    );
    expect(r.content.faqItems).toEqual([{ question: "Hours?", answer: "Nine to five." }]);
    expect(r.code).toContain("faq.question");
    expect(r.code).toContain("faq.answer");

    const cards = alignEditorDetailFields(
      "export const S = ({ data }: { data?: any }) => data.faqItems.map((item) => item.title);",
      { faqItems: [{ title: "Law", description: "Biz", image: "/a.jpg", slug: "law" }] },
      ["faqItems"],
      "FAQ",
    );
    expect((cards.content.faqItems as { title: string; image: string }[])[0]).toMatchObject({ title: "Law", image: "/a.jpg" });
    expect(cards.code).toContain("item.title");
  });

  it("maps button, contactButton, socialLinks and testimonials onto the popup keys", () => {
    const code = `export const B = ({ data }: { data?: any }) => (
      <section>
        <a href={data.button.url}>{data.button.label}</a>
        <a href={data.contactButton.href}>{data.contactButton.label}</a>
        {data.socialLinks.map((item) => <a key={item.icon} href={item.href} />)}
        {data.testimonials.map((item) => <p>{item.quote} {item.role}</p>)}
        <img src={data.logoText} alt={data.logoAlt} />
        <img src={data.hero} alt="" />
      </section>
    );`;
    const r = alignEditorDetailFields(
      code,
      {
        logoText: "Lexora",
        logoAlt: "Lexora logo",
        hero: "assets/hero/student.webp",
        button: { label: "Enroll Now", url: "/contact", icon: "FaArrowRight" },
        contactButton: { label: "Call", href: "/contact" },
        socialLinks: [{ icon: "FaFacebookF", href: "https://facebook.com" }],
        testimonials: [{ quote: "Great", role: "Client", photo: "assets/team/a.webp" }],
      },
      ["logoText", "logoAlt", "hero", "button", "contactButton", "socialLinks", "testimonials"],
      "Banner",
    );
    expect(r.content.logoText).toBe("Lexora");
    expect(r.content.logoAlt).toBe("Lexora logo");
    expect(r.content.hero).toBeUndefined();
    expect(r.content.imageMain).toBe("assets/hero/student.webp");
    expect(r.editorFields).toContain("imageMain");
    expect(r.content.button).toEqual({ text: "Enroll Now", href: "/contact", icon: "FaArrowRight", iconPosition: "after" });
    expect(r.content.contactButton).toEqual({ text: "Call", url: "/contact" });
    expect(r.content.socialLinks).toEqual([{ icon: "FaFacebookF", url: "https://facebook.com" }]);
    expect(r.content.testimonials).toEqual([{ message: "Great", designation: "Client", image: "assets/team/a.webp" }]);
    expect(r.code).toContain("data.button.href");
    expect(r.code).toContain("data.button.text");
    expect(r.code).toContain("data.contactButton.url");
    expect(r.code).toContain("data.contactButton.text");
    expect(r.code).toContain("href={item.url}");
    expect(r.code).toContain("item.message");
    expect(r.code).toContain("item.designation");
    expect(r.code).toContain("data.imageMain");

    const split = alignEditorDetailFields(
      `export const T = ({ data }: { data?: any }) => {
        const renderCard = (item: any) => <p>{item.role} {item.text} {item.author}</p>;
        const topRow = data.testimonials.slice(0, 2);
        return <div>{[...topRow, ...topRow].map((item) => renderCard(item))}</div>;
      };`,
      { testimonials: [{ text: "Great", role: "Client", author: "Ada" }] },
      ["testimonials"],
      "Testimonial",
    );
    expect(split.content.testimonials).toEqual([{ message: "Great", designation: "Client", name: "Ada" }]);
    expect(split.code).toContain("item.designation");
    expect(split.code).toContain("item.message");
    expect(split.code).toContain("item.name");
    expect(split.code).not.toContain("item.role");
    expect(split.code).not.toContain("item.text");
    expect(r.code).toContain("data.logoText");
  });
});

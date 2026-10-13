import { COMPANY, getCompanyBankAccount } from "../../constants/company.js";

export default function CompanyFooter({ isB2B = false }) {
  const bank = getCompanyBankAccount(isB2B);

  return (
    <>
      <table className="footer-grid">
        <tbody>
          <tr>
            <td>
              <span className="footer-label">{COMPANY.legalName}</span>
              {COMPANY.street}<br />
              {COMPANY.zip} {COMPANY.city}<br />
              Geschäftsführer: {COMPANY.managingDirectors.join(", ")}
            </td>
            <td>
              <span className="footer-label">Kontakt</span>
              {COMPANY.email}<br />
              Tel. {COMPANY.phone}
            </td>
            <td>
              <span className="footer-label">Handelsregister</span>
              {COMPANY.registerCourt}<br />
              {COMPANY.registerNumber}
            </td>
            <td>
              <span className="footer-label">Steuer</span>
              Steuer-ID: {COMPANY.taxNumber}<br />
              USt-ID: {COMPANY.vatId}<br />
              EORI: {COMPANY.eori}
            </td>
            <td>
              <span className="footer-label">Bankverbindung ({bank.label})</span>
              {bank.bankName}<br />
              IBAN: {bank.iban}<br />
              BIC: {bank.bic}
            </td>
          </tr>
        </tbody>
      </table>
      <div className="shop-name">{COMPANY.website}</div>
    </>
  );
}

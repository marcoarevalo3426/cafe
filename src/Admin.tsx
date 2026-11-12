import React, { useState } from "react";
import { View } from "react-native";
import {
  Box,
  Row,
  Copy,
  Small,
  Section,
  Btn,
  Field,
  Select,
  Dialog,
  Check,
  Link,
  Empty,
} from "./ui";
import { useApp } from "./context";
import { api } from "./api";
import { money, type User } from "./types";
import { chooseFile, exportJSON } from "./platform";
import { parseCafeImport } from "./import";
export default function Admin() {
  const { data, run, refresh, nav } = useApp();
  const [tab, setTab] = useState("Cafes"),
    [importText, setImportText] = useState(""),
    [price, setPrice] = useState(
      String((data.settings?.subscriptionPrice ?? 2900) / 100),
    ),
    [announcement, setAnnouncement] = useState(""),
    [editor, setEditor] = useState<Partial<User> | null>(null),
    [deleteUser, setDeleteUser] = useState<User | null>(null),
    [search, setSearch] = useState("");
  const execute = (body: any, message: string) =>
    run(async () => {
      await api("/admin", body);
      await refresh();
    }, message);
  return (
    <Section>
      <Select
        label="Manage"
        value={tab}
        onChange={setTab}
        options={[
          "Cafes",
          "Accounts",
          "Import cafes",
          "Subscriptions",
          "Feedback",
          "Announcements",
          "App builds",
          "Error logs",
        ].map((t) => ({ value: t, label: t }))}
      />
      {tab === "Cafes" ? (
        <>
          {data.stores.map((s) => (
            <Box
              key={s.id}
              style={{
                padding: 20,
                borderWidth: 1,
                borderColor: "#d9d9d9",
                borderRadius: 8,
              }}
            >
              <Copy style={{ fontWeight: "600" }}>{s.name}</Copy>
              <Small>{s.address}</Small>
              <Copy>Subscription: {s.subscription}</Copy>
              <Btn
                outline
                onPress={() =>
                  void execute(
                    {
                      action: "subscription",
                      storeId: s.id,
                      tier: s.tier === "paid" ? "free" : "paid",
                    },
                    "Subscription updated.",
                  )
                }
              >
                {s.tier === "paid" ? "Set free tier" : "Set paid tier"}
              </Btn>
              <Btn
                outline
                onPress={() =>
                  void execute(
                    { action: "build", storeId: s.id },
                    "App configuration generated.",
                  )
                }
              >
                Generate / duplicate app configuration
              </Btn>
            </Box>
          ))}
          <Btn onPress={() => nav("Generate vouchers")}>
            Generate vouchers for a cafe
          </Btn>
        </>
      ) : tab === "Accounts" ? (
        <>
          <Field
            label="Search accounts"
            value={search}
            onChange={setSearch}
            placeholder="Email or name"
          />
          <Btn
            onPress={() =>
              setEditor({
                email: "",
                name: "",
                phone: "",
                role: "customer",
                disabled: false,
              })
            }
          >
            Add account
          </Btn>
          {data.users
            ?.filter((u) =>
              `${u.email} ${u.name}`
                .toLowerCase()
                .includes(search.toLowerCase()),
            )
            .map((u) => (
              <Box
                key={u.id}
                style={{
                  borderBottomWidth: 1,
                  borderColor: "#d9d9d9",
                  paddingVertical: 16,
                  gap: 8,
                }}
              >
                <Copy>{u.name || u.email}</Copy>
                <Small>
                  {u.email} · {u.role ?? "Unassigned"}{" "}
                  {u.disabled ? "· Disabled" : ""}
                </Small>
                <Small>{u.phone}</Small>
                <Row>
                  <Link onPress={() => setEditor(u)}>Edit account</Link>
                  {u.role !== "admin" && (
                    <Link onPress={() => setDeleteUser(u)}>Delete account</Link>
                  )}
                </Row>
              </Box>
            ))}
        </>
      ) : tab === "Import cafes" ? (
        <>
          <Copy>Import cafes from CSV or JSON</Copy>
          <Small>
            Required fields: name, ownerEmail. Optional: ownerName, address.
            Existing cafes are updated by owner email.
          </Small>
          <Btn
            outline
            onPress={() =>
              void run(async () => {
                const file = await chooseFile(
                  ".csv,.json,text/csv,application/json",
                );
                if (file) {
                  if (!file.text)
                    throw new Error("The file is empty or larger than 700 KB.");
                  setImportText(file.text);
                }
              })
            }
          >
            Choose file
          </Btn>
          <Field
            label="CSV or JSON data"
            value={importText}
            onChange={setImportText}
            multiline
            numberOfLines={8}
            placeholder={
              "name,ownerEmail,ownerName,address\nGordon,owner@example.com,Anne,123 Bourke Street"
            }
          />
          <Btn
            onPress={() =>
              void run(async () => {
                const cafes = parseCafeImport(importText);
                await api("/admin", { action: "import", cafes });
                await refresh();
                setImportText("");
              }, "Cafes imported successfully.")
            }
          >
            Import cafes
          </Btn>
        </>
      ) : tab === "Subscriptions" ? (
        <>
          <Field
            label="Global monthly price (AUD)"
            value={price}
            onChange={setPrice}
            keyboardType="decimal-pad"
          />
          <Btn
            onPress={() =>
              void execute(
                { action: "settings", price: Math.round(Number(price) * 100) },
                "Global subscription price updated.",
              )
            }
          >
            Save subscription price
          </Btn>
          <Small>
            Subscription status is managed manually here. Automated recurring
            billing is not configured.
          </Small>
          {data.stores.map((s) => (
            <Row key={s.id}>
              <Copy style={{ flex: 1 }}>{s.name}</Copy>
              <Copy>
                {s.tier === "paid"
                  ? money(data.settings?.subscriptionPrice ?? 2900)
                  : "Free"}
              </Copy>
            </Row>
          ))}
        </>
      ) : tab === "Feedback" ? (
        <>
          {!data.feedback?.length && <Empty>No feedback yet.</Empty>}
          {data.feedback?.map((f) => (
            <Box
              key={f.id}
              style={{
                paddingBottom: 20,
                borderBottomWidth: 1,
                borderColor: "#d9d9d9",
              }}
            >
              <Copy style={{ fontWeight: "600" }}>
                {f.subject} · {f.rating}/5
              </Copy>
              <Copy>{f.message}</Copy>
              <Small>
                {f.email} · {new Date(f.createdAt).toLocaleString()}
              </Small>
            </Box>
          ))}
        </>
      ) : tab === "Announcements" ? (
        <>
          <Field
            label="Announcement"
            value={announcement}
            onChange={setAnnouncement}
            multiline
            numberOfLines={5}
            maxLength={1000}
          />
          <Btn
            onPress={() =>
              void execute(
                { action: "announcement", message: announcement },
                "Announcement queued for users who enabled announcements.",
              )
            }
          >
            Send push announcement
          </Btn>
        </>
      ) : tab === "App builds" ? (
        <>
          <Small>
            Configurations are generated for separate branded builds. Export a
            configuration and follow the README to build and deploy it with
            unique signing identities.
          </Small>
          {data.builds?.map((b) => (
            <Box key={b.id}>
              <Copy>{b.name}</Copy>
              <Small>{new Date(b.createdAt).toLocaleString()}</Small>
              <Btn
                outline
                onPress={() =>
                  void run(async () => {
                    const config = await api(`/admin/build/${b.id}`);
                    await exportJSON(config, `cafe-${b.id.slice(0, 8)}.json`);
                  })
                }
              >
                Export app configuration
              </Btn>
            </Box>
          ))}
        </>
      ) : (
        <>
          {!data.logs?.length && <Empty>No errors recorded.</Empty>}
          {data.logs?.map((l) => (
            <Box
              key={l.id}
              style={{
                gap: 8,
                paddingVertical: 12,
                borderBottomWidth: 1,
                borderColor: "#d9d9d9",
              }}
            >
              <Small>{new Date(l.createdAt).toLocaleString()}</Small>
              <Copy>{l.message}</Copy>
            </Box>
          ))}
        </>
      )}
      <Dialog
        visible={!!editor}
        title={editor?.id ? "Edit account" : "Add account"}
        onClose={() => setEditor(null)}
      >
        <Field
          label="Email address"
          value={editor?.email ?? ""}
          onChange={(email) => setEditor({ ...editor, email })}
          autoCapitalize="none"
          editable={!editor?.id}
        />
        <Field
          label="Name"
          value={editor?.name ?? ""}
          onChange={(name) => setEditor({ ...editor, name })}
        />
        <Field
          label="Mobile number"
          value={editor?.phone ?? ""}
          onChange={(phone) => setEditor({ ...editor, phone })}
          keyboardType="phone-pad"
        />
        {editor?.role !== "admin" && (
          <Select
            label="Role"
            value={editor?.role ?? "customer"}
            onChange={(role) =>
              setEditor({ ...editor, role: role as User["role"] })
            }
            options={["owner", "customer", "organisation"].map((r) => ({
              value: r,
              label: r,
            }))}
          />
        )}
        <Check
          checked={!!editor?.disabled}
          label="Disable account"
          onPress={() => setEditor({ ...editor, disabled: !editor?.disabled })}
        />
        <Btn
          onPress={() =>
            void run(async () => {
              await api("/admin", {
                ...editor,
                role: editor?.role === "admin" ? undefined : editor?.role,
                action: "user",
              });
              setEditor(null);
              await refresh();
            }, "Account saved.")
          }
        >
          Save
        </Btn>
      </Dialog>
      <Dialog
        visible={!!deleteUser}
        title="Delete account?"
        onClose={() => setDeleteUser(null)}
      >
        <Copy>
          Delete {deleteUser?.email}? Owned cafe data will also be deleted.
        </Copy>
        <Row>
          <Btn outline style={{ flex: 1 }} onPress={() => setDeleteUser(null)}>
            Cancel
          </Btn>
          <Btn
            style={{ flex: 1 }}
            onPress={() =>
              void run(async () => {
                await api("/admin", {
                  action: "delete-user",
                  id: deleteUser?.id,
                });
                setDeleteUser(null);
                await refresh();
              }, "Account deleted.")
            }
          >
            Delete
          </Btn>
        </Row>
      </Dialog>
    </Section>
  );
}

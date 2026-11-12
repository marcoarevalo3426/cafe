import React, { useState } from "react";
import { View, Pressable } from "react-native";
import {
  Box,
  Row,
  Copy,
  Small,
  Section,
  Btn,
  Field,
  Select,
  Check,
  Circle,
  Dialog,
  Line,
} from "./ui";
import { useApp } from "./context";
import { api } from "./api";
import { money, type MenuItem, type MenuGroup } from "./types";
const uid = () => Math.random().toString(36).slice(2, 14);
export default function MenuBuilder() {
  const { data, run, refresh } = useApp();
  const [mode, setMode] = useState("templates"),
    [category, setCategory] = useState(""),
    [sub, setSub] = useState(""),
    [editing, setEditing] = useState<MenuItem | null>(null),
    [template, setTemplate] = useState(false),
    [remove, setRemove] = useState<{
      category?: string;
      id?: string;
      name: string;
    } | null>(null);
  const [groups, setGroups] = useState<MenuGroup[]>([
    { id: uid(), name: "", variations: [{ id: uid(), name: "", amount: 0 }] },
  ]);
  const menu = data.menu.filter((m) => m.storeId === data.user?.storeId);
  const categories = [...new Set(menu.map((m) => m.category))];
  function edit(item: MenuItem) {
    setEditing(item);
    setCategory(item.category);
    setSub(item.subcategory);
    setGroups(JSON.parse(JSON.stringify(item.groups)));
    setMode("builder");
  }
  function groupChange(i: number, update: Partial<MenuGroup>) {
    setGroups(groups.map((g, j) => (j === i ? { ...g, ...update } : g)));
  }
  async function save() {
    await run(
      async () => {
        await api("/menu", {
          id: editing?.id,
          category,
          subcategory: sub,
          groups,
          template,
        });
        await refresh();
        setEditing(null);
        setSub("");
        setGroups([
          {
            id: uid(),
            name: "",
            variations: [{ id: uid(), name: "", amount: 0 }],
          },
        ]);
      },
      editing ? "Menu updated." : "Menu added.",
    );
  }
  return (
    <Box style={{ gap: 0 }}>
      <Section style={{ minHeight: 100, justifyContent: "center" }}>
        <Row>
          <Copy style={{ flex: 1 }}>Generate using</Copy>
          <View style={{ flex: 1.6 }}>
            <Select
              label={undefined}
              value={mode}
              onChange={(v) => {
                setMode(v);
                setEditing(null);
              }}
              options={[
                { value: "templates", label: "Pre-built templates" },
                { value: "builder", label: "Menu Builder" },
              ]}
            />
          </View>
        </Row>
      </Section>
      <Line />
      {mode === "templates" ? (
        <Section style={{ gap: 0, paddingTop: 0, paddingBottom: 30 }}>
          {[
            "Coffee",
            "Tea",
            "Cold drinks",
            "Food",
            "Pies",
            "Sweets",
            "Kids menu",
          ].map((name) => (
            <Row
              key={name}
              style={{
                minHeight: 74,
                borderBottomWidth: 1,
                borderColor: "#d9d9d9",
                paddingLeft: 15,
              }}
            >
              <Copy style={{ fontWeight: "600", flex: 1 }}>
                All {name} {categories.includes(name) && <Small>(Added)</Small>}
              </Copy>
              <Circle
                kind="plus"
                label={`Add all ${name}`}
                onPress={() =>
                  void run(async () => {
                    await api("/menu/template", { name });
                    await refresh();
                  }, `${name} menu added.`)
                }
              />
            </Row>
          ))}
        </Section>
      ) : (
        <Section>
          {editing ? (
            <Copy>
              Update: {category} &gt;{" "}
              <Copy style={{ fontWeight: "700" }}>{sub}</Copy>
            </Copy>
          ) : (
            <>
              <Field
                label="Category"
                placeholder="New category"
                value={category}
                onChange={setCategory}
              />
              {categories.length > 0 && (
                <Select
                  label="Use existing category"
                  value={category}
                  onChange={setCategory}
                  options={categories.map((c) => ({ value: c, label: c }))}
                />
              )}
              <Field
                label="Sub category"
                placeholder="New sub category"
                value={sub}
                onChange={setSub}
              />
              {menu.some((m) => m.category === category) && (
                <Select
                  label="Edit an existing sub category"
                  value=""
                  onChange={(id) => {
                    const item = menu.find((m) => m.id === id);
                    if (item) edit(item);
                  }}
                  options={menu
                    .filter((m) => m.category === category)
                    .map((m) => ({ value: m.id, label: m.subcategory }))}
                />
              )}
              {data.templates.length > 0 && (
                <Select
                  label="Use an item template"
                  value=""
                  onChange={(id) => {
                    const t = data.templates.find((x) => x.id === id);
                    if (t) setGroups(JSON.parse(JSON.stringify(t.groups)));
                  }}
                  options={data.templates.map((t) => ({
                    value: t.id,
                    label: `${t.subcategory} · ${t.groups.map((g) => g.name).join(", ")}`,
                  }))}
                />
              )}
            </>
          )}
          {editing && (
            <Btn
              outline
              onPress={() => {
                setEditing(null);
                setSub("");
                setGroups([
                  {
                    id: uid(),
                    name: "",
                    variations: [{ id: uid(), name: "", amount: 0 }],
                  },
                ]);
              }}
            >
              Create a new sub category
            </Btn>
          )}
          {groups.map((g, i) => (
            <Box
              key={g.id}
              style={{
                backgroundColor: "#d9d9d9",
                borderRadius: 10,
                padding: 20,
                gap: 24,
              }}
            >
              <Field
                label="Item"
                placeholder="Example: Size, Milk Type, Strength"
                value={g.name}
                onChange={(name) => groupChange(i, { name })}
              />
              <Copy>
                Variation <Small>Example: Reg, Large, X Large</Small>
              </Copy>
              <Row>
                <View style={{ flex: 2 }} />
                <Small style={{ flex: 1 }}>AMOUNT</Small>
                <View style={{ width: 48 }} />
              </Row>
              {g.variations.map((v, j) => (
                <Row key={v.id} style={{ gap: 8 }}>
                  <Field
                    style={{ flex: 2 }}
                    value={v.name}
                    onChange={(name) =>
                      groupChange(i, {
                        variations: g.variations.map((x, k) =>
                          k === j ? { ...x, name } : x,
                        ),
                      })
                    }
                    placeholder="Variation name"
                    label={undefined}
                    accessibilityLabel={`Variation ${j + 1} name`}
                  />
                  <Field
                    style={{ flex: 1, minWidth: 64 }}
                    value={String(v.amount / 100)}
                    keyboardType="decimal-pad"
                    onChange={(amount) =>
                      groupChange(i, {
                        variations: g.variations.map((x, k) =>
                          k === j
                            ? { ...x, amount: Math.round(Number(amount) * 100) }
                            : x,
                        ),
                      })
                    }
                    accessibilityLabel={`Variation ${j + 1} amount`}
                  />
                  {j > 0 ? (
                    <Circle
                      kind="minus"
                      label={`Delete variation ${j + 1}`}
                      onPress={() =>
                        groupChange(i, {
                          variations: g.variations.filter((_, k) => k !== j),
                        })
                      }
                    />
                  ) : (
                    <View style={{ width: 48 }} />
                  )}
                </Row>
              ))}
              {g.variations.length < 30 && (
                <Row style={{ justifyContent: "flex-end" }}>
                  <Small>Add variation ({g.variations.length}/30)</Small>
                  <Circle
                    kind="plus"
                    label="Add variation"
                    onPress={() =>
                      groupChange(i, {
                        variations: [
                          ...g.variations,
                          { id: uid(), name: "", amount: 0 },
                        ],
                      })
                    }
                  />
                </Row>
              )}
              {i > 0 && (
                <Btn
                  outline
                  onPress={() => setGroups(groups.filter((_, j) => i !== j))}
                >
                  Remove item group
                </Btn>
              )}
            </Box>
          ))}
          {groups.length < 10 && (
            <Btn
              outline
              onPress={() =>
                setGroups([
                  ...groups,
                  {
                    id: uid(),
                    name: "",
                    variations: [{ id: uid(), name: "", amount: 0 }],
                  },
                ])
              }
            >
              Add item group
            </Btn>
          )}
          <Check
            checked={template}
            onPress={() => setTemplate(!template)}
            label="Save as Item template"
          />
          <Btn
            style={{ width: 172, alignSelf: "flex-end" }}
            onPress={() => void save()}
          >
            {editing ? "Update" : "Add"}
          </Btn>
          {editing && (
            <>
              <Copy>Item preview</Copy>
              <Box style={{ backgroundColor: "#e8e8e8", padding: 20 }}>
                <Copy style={{ fontSize: 20 }}>{sub}</Copy>
                {groups.map((g) => (
                  <Box key={g.id}>
                    <Copy>{g.name.toUpperCase()}</Copy>
                    <Row style={{ flexWrap: "wrap" }}>
                      {g.variations.map((v) => (
                        <View
                          key={v.id}
                          style={{
                            padding: 12,
                            backgroundColor: "white",
                            borderRadius: 4,
                          }}
                        >
                          <Copy>
                            {v.name} · {money(v.amount)}
                          </Copy>
                        </View>
                      ))}
                    </Row>
                  </Box>
                ))}
              </Box>
            </>
          )}
        </Section>
      )}
      <Line />
      <Section>
        <Copy style={{ fontSize: 20 }}>Categories preview</Copy>
        {!menu.length && (
          <Small>
            Create a category or add a pre-built menu to get started.
          </Small>
        )}
        {categories.map((c) => (
          <Box key={c} style={{ gap: 0 }}>
            <Row
              style={{
                backgroundColor: "#000",
                paddingLeft: 15,
                minHeight: 40,
              }}
            >
              <Copy style={{ color: "white", flex: 1 }}>{c}</Copy>
              <Circle
                kind="minus"
                label={`Delete category ${c}`}
                onPress={() => setRemove({ category: c, name: c })}
              />
            </Row>
            {menu
              .filter((m) => m.category === c)
              .map((m) => (
                <Row
                  key={m.id}
                  style={{ borderBottomWidth: 1, borderColor: "#d9d9d9" }}
                >
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Edit ${m.subcategory}`}
                    onPress={() => edit(m)}
                    style={{ flex: 1, padding: 15, gap: 4 }}
                  >
                    <Copy>{m.subcategory}</Copy>
                    <Copy>
                      {money(
                        m.groups.reduce(
                          (sum, g) =>
                            sum +
                            Math.min(...g.variations.map((v) => v.amount)),
                          0,
                        ),
                      )}
                      +
                    </Copy>
                  </Pressable>
                  <Circle
                    kind="minus"
                    label={`Delete ${m.subcategory}`}
                    onPress={() => setRemove({ id: m.id, name: m.subcategory })}
                  />
                </Row>
              ))}
          </Box>
        ))}
      </Section>
      <Dialog
        visible={!!remove}
        title="Delete menu"
        onClose={() => setRemove(null)}
      >
        <Copy>
          Deleting the {remove?.category ? "category" : "Sub category"}{" "}
          {remove?.name} will also delete all the{" "}
          {remove?.category ? "Sub categorys" : "items and variations"}{" "}
          associated with it.
        </Copy>
        <Row>
          <Btn style={{ flex: 1 }} outline onPress={() => setRemove(null)}>
            Cancel
          </Btn>
          <Btn
            style={{ flex: 1 }}
            onPress={() =>
              void run(async () => {
                await api("/menu/delete", remove);
                setRemove(null);
                await refresh();
              }, "Menu deleted.")
            }
          >
            Delete
          </Btn>
        </Row>
      </Dialog>
    </Box>
  );
}
